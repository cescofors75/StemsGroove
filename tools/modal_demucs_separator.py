import modal

app = modal.App("demucs-separator")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "numpy<2",
        "demucs==4.0.1",
        "torch==2.1.2",
        "torchaudio==2.1.2",
        "fastapi[standard]",
    )
)

# Imagen ligera para descarga de YouTube (sin torch/demucs)
youtube_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("yt-dlp", "fastapi[standard]")
)

# Cache de modelos entre cold starts
model_cache = modal.Volume.from_name("demucs-cache", create_if_missing=True)


@app.function(
    image=youtube_image,
    cpu=1.0,
    memory=1024,
    max_containers=5,
    timeout=120,
)
@modal.fastapi_endpoint(method="POST", docs=True)
def download_youtube(payload: dict):
    import base64
    import subprocess
    import tempfile
    from pathlib import Path
    from fastapi import HTTPException

    url = (payload.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Falta el campo 'url'")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cmd = [
            "yt-dlp",
            "-x", "--audio-format", "mp3", "--audio-quality", "0",
            "--no-playlist", "--max-filesize", "150m",
            "--socket-timeout", "30", "--no-warnings",
            "-o", str(tmp_path / "%(title).100B.%(ext)s"),
            url,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=100)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").lower()
            if "unavailable" in stderr or "private" in stderr or "not available" in stderr:
                raise HTTPException(status_code=400, detail="Video no disponible o privado")
            if "age" in stderr or "sign in" in stderr:
                raise HTTPException(status_code=403, detail="Video con restricción de edad")
            if "copyright" in stderr or "blocked" in stderr:
                raise HTTPException(status_code=403, detail="Video bloqueado por derechos de autor")
            raise HTTPException(status_code=500, detail="Error al descargar el audio")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=500, detail="La descarga tardó demasiado")

        mp3_files = list(tmp_path.glob("*.mp3"))
        if not mp3_files:
            raise HTTPException(status_code=500, detail="No se pudo extraer el audio MP3")

        mp3 = mp3_files[0]
        audio_b64 = base64.b64encode(mp3.read_bytes()).decode()
        return {
            "audio": audio_b64,
            "filename": mp3.name,
            "content_type": "audio/mpeg",
        }


@app.function(
    image=image,
    gpu="T4",
    cpu=4.0,
    memory=8192,
    max_containers=20,
    min_containers=1,
    volumes={"/root/.cache/torch": model_cache},
    timeout=300,
    scaledown_window=300,
)
@modal.fastapi_endpoint(method="POST", docs=True)
def separate(audio_b64: dict):
    import base64
    import io
    import subprocess
    import tempfile
    import zipfile
    from fastapi import HTTPException, Response
    from pathlib import Path

    # Recibe {"audio": "<base64>", "filename": "track.mp3", "model": "htdemucs"}
    if not isinstance(audio_b64, dict) or "audio" not in audio_b64:
        raise HTTPException(status_code=400, detail="Missing JSON body field: audio")

    VALID_MODELS = {"htdemucs", "htdemucs_ft", "htdemucs_6s", "mdx_extra", "mdx_extra_q"}
    model = audio_b64.get("model", "htdemucs")
    if model not in VALID_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid model '{model}'. Valid options: {sorted(VALID_MODELS)}")

    print(f"[demucs-separator] model={model!r}  filename={audio_b64.get('filename')!r}")

    try:
        data = base64.b64decode(audio_b64["audio"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {exc}") from exc

    filename = audio_b64.get("filename", "input.mp3")

    segment = audio_b64.get("segment")
    no_mp3 = bool(audio_b64.get("no_mp3", False))
    shifts = int(audio_b64.get("shifts", 0))        # 0 = sin TTA → ~2× más rápido
    overlap = float(audio_b64.get("overlap", 0.1))  # 0.1 = menor solapado → más rápido

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        in_path = tmp_path / filename
        in_path.write_bytes(data)
        out_dir = tmp_path / "out"

        cmd = [
            "python", "-m", "demucs.separate",
            "-n", model,
            "-o", str(out_dir),
            "--shifts", str(max(0, shifts)),
        ]
        # --overlap y --segment solo aplican a modelos htdemucs (segmented processing)
        if model.startswith("htdemucs"):
            cmd += ["--overlap", str(max(0.0, min(0.5, overlap)))]
        if not no_mp3:
            cmd.append("--mp3")
        if segment is not None:
            try:
                seg_val = int(float(segment))
                if 1 <= seg_val <= 300:
                    cmd += ["--segment", str(seg_val)]
            except (ValueError, TypeError):
                pass
        cmd.append(str(in_path))

        print(f"[demucs-separator] cmd={cmd!r}  no_mp3={no_mp3}  segment={segment}")

        try:
            subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or "Demucs failed").strip()
            raise HTTPException(status_code=500, detail=f"Demucs error: {detail[:2000]}") from exc

        try:
            stems_dir = next((out_dir / model).iterdir())
        except StopIteration as exc:
            raise HTTPException(status_code=500, detail="Demucs output folder not found") from exc

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
            for stem in stems_dir.iterdir():
                print(f"[demucs-separator] adding to ZIP: {stem.name}")
                archive.write(stem, arcname=stem.name)

        return Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="stems.zip"',
            },
        )

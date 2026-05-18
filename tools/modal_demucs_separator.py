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

# Cache de modelos entre cold starts
model_cache = modal.Volume.from_name("demucs-cache", create_if_missing=True)


@app.function(
    image=image,
    gpu="T4",
    volumes={"/root/.cache/torch": model_cache},
    timeout=600,
    scaledown_window=120,
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

    # Recibe {"audio": "<base64>", "filename": "track.mp3"}
    if not isinstance(audio_b64, dict) or "audio" not in audio_b64:
        raise HTTPException(status_code=400, detail="Missing JSON body field: audio")

    try:
        data = base64.b64decode(audio_b64["audio"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {exc}") from exc

    filename = audio_b64.get("filename", "input.mp3")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        in_path = tmp_path / filename
        in_path.write_bytes(data)
        out_dir = tmp_path / "out"

        try:
            subprocess.run(
            [
                "python",
                "-m",
                "demucs.separate",
                "-n",
                "htdemucs",
                "-o",
                str(out_dir),
                "--mp3",
                str(in_path),
            ],
            check=True,
            capture_output=True,
            text=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or "Demucs failed").strip()
            raise HTTPException(status_code=500, detail=f"Demucs error: {detail[:2000]}") from exc

        try:
            stems_dir = next((out_dir / "htdemucs").iterdir())
        except StopIteration as exc:
            raise HTTPException(status_code=500, detail="Demucs output folder not found") from exc

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
            for stem in stems_dir.iterdir():
                archive.write(stem, arcname=stem.name)

        return Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="stems.zip"',
            },
        )

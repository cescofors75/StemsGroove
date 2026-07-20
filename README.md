<div align="center">

# 🎚️ STEMS — Four-Stem Separator

**Split any audio track into Vocals · Drums · Bass · Other**
*Powered by [Demucs HTDemucs](https://github.com/facebookresearch/demucs) · Built with Next.js 15 · GPU-accelerated (CUDA)*

![preview](preview.png)

**🎧 DJ or producer and just want it running? → [GUIA-DJS.md](GUIA-DJS.md)**

</div>

---

## ✨ Features

- 🎤 **Vocals** — lead and backing vocals isolated
- 🥁 **Drums** — kick, snare, hats and all percussion
- 🎸 **Bass** — bass guitar and low-frequency content
- 🎹 **Other** — guitars, synths and remaining layers
- 💻 **Fully local engine** — runs Demucs on your own machine (`INSTALAR.bat` / `instalar.sh`), no internet required after install
- ☁️ **Optional cloud engine** — remote separation via Modal, for machines without Python installed
- ⚡ **GPU-accelerated** — uses CUDA automatically when a NVIDIA GPU is detected
- 🎛️ **6S / 4S modes** — 6 stems (adds guitar & piano) or 4 stems, faster
- 📡 **REST API with CORS** — integrate from any frontend project
- 🔊 **Per-stem volume control** — independent sliders per stem
- ⬇️ **MP3 download** — one click per stem

---

## 🚀 Quick Start

### Easiest way: the installer

If you just want the app running locally with zero fuss (recommended
for DJs/producers — see [GUIA-DJS.md](GUIA-DJS.md)):

- **Windows:** double-click `INSTALAR.bat`, then `INICIAR.bat` on later runs.
- **macOS/Linux:** run `./instalar.sh`, then `./iniciar.sh` on later runs.

These scripts install Node deps, create a Python venv, install Demucs
and launch the app at `http://localhost:3000` — fully offline after
the first install.

### Manual install

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | `node --version` |
| Python | **3.12** | 3.14 is NOT supported by PyTorch |
| FFmpeg | ≥ 6 | must be in `PATH` |
| NVIDIA CUDA driver | 12.1+ | optional, for GPU acceleration |

### Install

```bash
# Node packages
npm install

# Python virtual environment + demucs
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install "numpy<2" demucs

# (Optional) CUDA-accelerated PyTorch for NVIDIA GPUs
.venv\Scripts\python.exe -m pip install --force-reinstall torch torchaudio ^
  --index-url https://download.pytorch.org/whl/cu121
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) 🎉

The UI lets you pick between the **LOCAL** engine (runs Demucs on
your machine via `/api/separate`, no internet needed) and the
**NUBE/cloud** engine (remote Modal endpoint, useful as a fallback).

---

## 📡 REST API

Stems exposes two API routes you can call from **any other project** (CORS enabled).

### `POST /api/separate`

Accepts a `multipart/form-data` request and returns URLs for each stem.

```js
const form = new FormData();
form.append("file", audioFile);     // .wav | .mp3 | .flac | .aiff
form.append("mode", "htdemucs_6s"); // "htdemucs" | "htdemucs_6s" | "htdemucs_ft" | "mdx_extra"

const res = await fetch("http://localhost:3000/api/separate", {
  method: "POST",
  body: form,
});

const { runId, stems, mode } = await res.json();
// stems = {
//   vocals: "/api/stems/<runId>/vocals",
//   drums:  "/api/stems/<runId>/drums",
//   bass:   "/api/stems/<runId>/bass",
//   other:  "/api/stems/<runId>/other",
// }
```

### `GET /api/stems/:runId/:stem`

Streams the requested stem as `audio/mpeg`.

```js
const audio = new Audio(`http://localhost:3000${stems.vocals}`);
audio.play();
```

### Restrict allowed origins (optional)

Create `.env.local`:

```env
CORS_ALLOWED_ORIGINS=http://localhost:3001,https://your-other-app.com
```

Without this variable all origins (`*`) are allowed.

---

## 🧠 Processing Modes

| Mode | Model | Stems | Speed |
|---|---|---|---|
| `htdemucs` | HTDemucs | 4 (vocals/drums/bass/other) | ⚡⚡ |
| `htdemucs_ft` | HTDemucs fine-tuned | 4 | ⚡ |
| `htdemucs_6s` | HTDemucs 6-stem | 6 (adds guitar/piano) | ⚡⚡ |
| `mdx_extra` | MDX Extra | 4 | ⚡⚡⚡ |

All stems are exported as 224 kbps MP3.

> GPU (CUDA): ~30-60 s/track · CPU only: ~5-10 min/track

---

## 🗂️ Project Structure

```
stems/
├── app/
│   ├── page.jsx                       # Main UI — upload, playback, sequencer
│   ├── layout.jsx
│   ├── globals.css
│   └── api/
│       ├── separate/route.js          # POST — runs Demucs, returns stem URLs
│       └── stems/[runId]/[stem]/
│           └── route.js               # GET  — streams stem MP3
├── lib/
│   └── cors.js                        # CORS helper (shared by API routes)
├── scripts/
│   └── dev-solo.cjs                   # Dev server launcher
├── INSTALAR.bat / instalar.sh         # One-click installer (Node + Python + Demucs)
├── INICIAR.bat / iniciar.sh           # Daily launcher (after install)
├── GUIA-DJS.md                        # Non-technical guide for DJs/producers
├── .venv/                             # Python 3.12 venv (git-ignored)
├── .stems/                            # Temporary stem output (git-ignored)
└── next.config.mjs
```

---

## ⚙️ How it works

```
Browser  ──POST /api/separate──▶  Next.js Route Handler
                                        │
                               saves audio to tmp dir
                                        │
                               .venv/Scripts/python.exe
                               -m demucs.separate ...
                                        │  (GPU via CUDA if available)
                               htdemucs / mdx_extra model
                                        │
                               4 × stem.mp3 → .stems/<runId>/
                               temp dir cleaned up automatically
                                        │
                         ◀── { runId, stems{} } JSON ──

Browser  ──GET /api/stems/<runId>/vocals──▶  streams audio/mpeg
```

An optional cloud fallback (`lib/modal-separator.js` + `tools/modal_demucs_separator.py`) runs the same Demucs separation on a remote [Modal](https://modal.com) endpoint for machines that can't install Python/Demucs locally. Select it with the **NUBE** toggle in the UI; it requires setting `NEXT_PUBLIC_MODAL_SEPARATE_URL`.

---

## 📦 Windows Quick Install

```powershell
winget install --id Python.Python.3.12
winget install --id Gyan.FFmpeg
```

---

## 📄 License

MIT


## Requisitos

- Node.js 18+
- Python 3.9+ (recomendado 3.12)
- `ffmpeg` disponible en PATH

> Atajo: `INSTALAR.bat` (Windows) o `./instalar.sh` (macOS/Linux) hacen
> todo esto automaticamente. Ver [GUIA-DJS.md](GUIA-DJS.md).

## 1) Instalar dependencias de Python

```bash
python -m venv .venv
.venv\Scripts\python.exe -m pip install "numpy<2" demucs   # Windows
# .venv/bin/python3 -m pip install "numpy<2" demucs        # macOS/Linux
```

Nota: En este proyecto, Demucs se ejecuta desde la API de Next.js usando `python -m demucs.separate`.

## 2) Instalar dependencias de Node

```bash
npm install
```

## 3) Ejecutar en local

```bash
npm run dev
```

Abre `http://localhost:3000`.

Este comando ahora arranca en modo `dev:solo`: mata procesos `next dev` previos, limpia `.next` y normaliza ruta para evitar errores de chunks tipo `Cannot find module './331.js'`.

Si aparece un error tipo `Cannot find module './331.js'` o chunks faltantes en `.next`, usa arranque limpio:

```bash
npm run dev:clean
```

Tambien puedes usar:

```bash
npm run dev:solo
```

Tip: evita correr `npm run build` y `npm run dev` al mismo tiempo en otra terminal.

Para uso diario estable (sin hot reload), puedes usar modo produccion local:

```bash
npm run serve
```

## Flujo

- `app/page.jsx`: UI de carga, progreso, reproduccion y descarga de stems.
- `app/api/separate/route.js`: recibe archivo, ejecuta HTDemucs, guarda stems en `.stems/<runId>/`.
- `app/api/stems/[runId]/[stem]/route.js`: sirve cada stem como `audio/mpeg`.

## Notas de rendimiento

- GPU CUDA: aprox. 30-60s por track.
- CPU: aprox. 5-10 min por track.

## Limpieza de archivos

Los stems se guardan en `.stems/`. Puedes limpiar manualmente esa carpeta cuando quieras.

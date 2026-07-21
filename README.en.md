# Open Stems Separator - English Guide

Stem separation tool for DJs and producers. Turn a full song into stems for remixing, mashups, edits, and practice.

## Quick start (recommended)

Built for booth and studio workflows: install once, launch in one click.

### Windows

1. Run INSTALAR.bat (first time only).
2. Then run INICIAR.bat for daily sessions.

### macOS / Linux

1. Run ./instalar.sh (first time only).
2. Then run ./iniciar.sh for daily sessions.

Local URL: http://localhost:3000

## What these scripts do

- INSTALAR.bat / instalar.sh
  - installs Node dependencies
  - creates a Python virtual environment (.venv)
  - installs Demucs and required packages
- INICIAR.bat / iniciar.sh
  - starts the app quickly for everyday use

## Workflow to separate a song

1. Drag a WAV, MP3, FLAC, or AIFF file, or paste a YouTube link.
2. Choose separation mode.
   - 4 stems: vocals, drums, bass, other (faster)
   - 6 stems: vocals, drums, bass, guitar, piano, other (more detail)
3. Process the song.
4. Preview, mix, and download each stem.

## Local engine vs cloud engine

- Local (recommended): runs Demucs on your machine.
- Cloud (optional): uses a remote Modal endpoint as backup.

## Estimated performance

- NVIDIA GPU (CUDA): 30 to 60 seconds per song.
- CPU only: 5 to 10 minutes per song.

## For developers (short)

### Scripts

- npm run dev
- npm run dev:clean
- npm run build
- npm run start
- npm run serve
- npm run lint

### API

- POST /api/separate (audio upload + separation)
- GET /api/stems/:runId/:stem (stem streaming)

### Key files

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Other guides

- Main index: [README.md](README.md)
- DJ quick guide: [GUIA-DJS.md](GUIA-DJS.md)

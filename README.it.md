# Open Stems Separator - Guida in Italiano

Strumento di separazione stems per DJ e produttori. Trasforma una canzone completa in tracce per remix, mashup, edits e pratica.

## Avvio rapido (consigliato)

Pensato per cabina e studio: installa una volta, avvia ogni giorno con un clic.

### Windows

1. Esegui INSTALAR.bat (solo la prima volta).
2. Poi esegui INICIAR.bat per le sessioni quotidiane.

### macOS / Linux

1. Esegui ./instalar.sh (solo la prima volta).
2. Poi esegui ./iniciar.sh per le sessioni quotidiane.

URL locale: http://localhost:3000

## Cosa fanno questi script

- INSTALAR.bat / instalar.sh
  - installa dipendenze Node
  - crea ambiente Python (.venv)
  - installa Demucs e pacchetti necessari
- INICIAR.bat / iniciar.sh
  - avvia l'app rapidamente per l'uso quotidiano

## Flusso per separare un brano

1. Trascina un file WAV, MP3, FLAC o AIFF, oppure incolla un link YouTube.
2. Scegli la modalita di separazione.
   - 4 stems: voce, batteria, basso, altri (piu veloce)
   - 6 stems: voce, batteria, basso, chitarra, piano, altri (piu dettaglio)
3. Avvia il processo.
4. Ascolta, mixa e scarica ogni traccia.

## Motore locale vs motore cloud

- Locale (consigliato): elabora sul tuo computer con Demucs.
- Cloud (opzionale): usa un endpoint remoto Modal come backup.

## Prestazioni indicative

- GPU NVIDIA (CUDA): 30 a 60 secondi per brano.
- Solo CPU: 5 a 10 minuti per brano.

## Per sviluppatori (breve)

### Script

- npm run dev
- npm run dev:clean
- npm run build
- npm run start
- npm run serve
- npm run lint

### API

- POST /api/separate
- GET /api/stems/:runId/:stem

### File chiave

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Altre guide

- Indice principale: [README.md](README.md)
- Guida DJ rapida: [GUIA-DJS.md](GUIA-DJS.md)

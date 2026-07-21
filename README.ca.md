# Open Stems Separator - Guia en Catala

Eina de separacio de stems per a DJs i productors. Converteix una canco completa en pistes per a remix, mashup, edits i practica.

## Inici rapid (recomanat)

Pensat per a cabina i estudi: instal.la una vegada i obre amb doble clic.

### Windows

1. Executa INSTALAR.bat (nomes la primera vegada).
2. Despres executa INICIAR.bat a cada sessio.

### macOS / Linux

1. Executa ./instalar.sh (nomes la primera vegada).
2. Despres executa ./iniciar.sh a cada sessio.

URL local: http://localhost:3000

## Que fan aquests scripts

- INSTALAR.bat / instalar.sh
  - instal.la dependencies de Node
  - crea entorn Python (.venv)
  - instal.la Demucs i paquets necessaris
- INICIAR.bat / iniciar.sh
  - arrenca l'app rapidament per a us diari

## Flux per separar un tema

1. Arrossega un fitxer WAV, MP3, FLAC o AIFF, o enganxa un enllac de YouTube.
2. Tria mode de separacio.
   - 4 stems: veu, bateria, baix, altres (mes rapid)
   - 6 stems: veu, bateria, baix, guitarra, piano, altres (mes detall)
3. Processa el tema.
4. Escolta, mescla i descarrega cada pista.

## Motor local vs motor nuvol

- Local (recomanat): processa al teu equip amb Demucs.
- Nuvol (opcional): usa un endpoint remot de Modal com a suport.

## Rendiment orientatiu

- GPU NVIDIA (CUDA): 30 a 60 segons per tema.
- Nomes CPU: 5 a 10 minuts per tema.

## Per a desenvolupadors (resum)

### Scripts

- npm run dev
- npm run dev:clean
- npm run build
- npm run start
- npm run serve
- npm run lint

### API

- POST /api/separate
- GET /api/stems/:runId/:stem

### Fitxers clau

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Altres guies

- Index principal: [README.md](README.md)
- Guia DJ rapida: [GUIA-DJS.md](GUIA-DJS.md)

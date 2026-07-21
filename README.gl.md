# Open Stems Separator - Guia en Galego

Ferramenta de separacion de stems para DJs e produtores. Converte unha cancion completa en pistas para remix, mashup, edits e practica.

## Inicio rapido (recomendado)

Pensado para cabina e estudio: instala unha vez e abre cun clic cada dia.

### Windows

1. Executa INSTALAR.bat (so na primeira vez).
2. Despois executa INICIAR.bat nas sesions diarias.

### macOS / Linux

1. Executa ./instalar.sh (so na primeira vez).
2. Despois executa ./iniciar.sh nas sesions diarias.

URL local: http://localhost:3000

## Que fan estes scripts

- INSTALAR.bat / instalar.sh
  - instala dependencias de Node
  - crea contorno Python (.venv)
  - instala Demucs e paquetes necesarios
- INICIAR.bat / iniciar.sh
  - arranca a app rapidamente para uso diario

## Fluxo para separar un tema

1. Arrastra un ficheiro WAV, MP3, FLAC ou AIFF, ou pega unha ligazon de YouTube.
2. Escolle o modo de separacion.
   - 4 stems: voz, bateria, baixo, outros (mais rapido)
   - 6 stems: voz, bateria, baixo, guitarra, piano, outros (mais detalle)
3. Procesa o tema.
4. Escoita, mestura e descarga cada pista.

## Motor local vs motor nube

- Local (recomendado): procesa no teu equipo con Demucs.
- Nube (opcional): usa un endpoint remoto de Modal como respaldo.

## Rendemento orientativo

- GPU NVIDIA (CUDA): 30 a 60 segundos por tema.
- So CPU: 5 a 10 minutos por tema.

## Para desenvolvedores (resumo)

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

### Ficheiros clave

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Outras guias

- Indice principal: [README.md](README.md)
- Guia DJ rapida: [GUIA-DJS.md](GUIA-DJS.md)

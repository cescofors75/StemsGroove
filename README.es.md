# Open Stems Separator - Guia en Espanol

Herramienta de separacion de stems para DJs y productores. Convierte una cancion completa en pistas para remix, mashup, edits y practica.

## Inicio rapido (recomendado)

Pensado para cabina y estudio: instala una vez y abre con doble clic.

### Windows

1. Ejecuta INSTALAR.bat (solo la primera vez).
2. Luego ejecuta INICIAR.bat en cada sesion.

### macOS / Linux

1. Ejecuta ./instalar.sh (solo la primera vez).
2. Luego ejecuta ./iniciar.sh en cada sesion.

URL local: http://localhost:3000

## Que hacen estos scripts

- INSTALAR.bat / instalar.sh
  - instala dependencias de Node
  - crea entorno Python (.venv)
  - instala Demucs y paquetes necesarios
- INICIAR.bat / iniciar.sh
  - arranca la app rapidamente para uso diario

## Flujo para separar un tema

1. Arrastra un archivo WAV, MP3, FLAC o AIFF, o pega un enlace de YouTube.
2. Elige modo de separacion.
   - 4 stems: voz, bateria, bajo, otros (mas rapido)
   - 6 stems: voz, bateria, bajo, guitarra, piano, otros (mas detalle)
3. Procesa el tema.
4. Escucha, mezcla y descarga cada pista.

## Motor local vs motor nube

- Local (recomendado): procesa en tu equipo con Demucs.
- Nube (opcional): usa un endpoint remoto de Modal como respaldo.

## Rendimiento orientativo

- GPU NVIDIA (CUDA): 30 a 60 segundos por tema.
- Solo CPU: 5 a 10 minutos por tema.

## Para desarrolladores (resumen)

### Scripts

- npm run dev
- npm run dev:clean
- npm run build
- npm run start
- npm run serve
- npm run lint

### API

- POST /api/separate (subida de audio y separacion)
- GET /api/stems/:runId/:stem (streaming de pista)

### Archivos clave

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Otras guias

- Indice general: [README.md](README.md)
- Guia DJ rapida: [GUIA-DJS.md](GUIA-DJS.md)

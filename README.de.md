# Open Stems Separator - Deutsche Anleitung

Stem-Separation fuer DJs und Produzenten. Wandelt einen kompletten Song in Spuren fuer Remix, Mashup, Edits und Uebung um.

## Schnellstart (empfohlen)

Fuer Booth und Studio gedacht: einmal installieren, taeglich mit einem Klick starten.

### Windows

1. Fuehre INSTALAR.bat aus (nur beim ersten Mal).
2. Danach starte INICIAR.bat fuer taegliche Sessions.

### macOS / Linux

1. Fuehre ./instalar.sh aus (nur beim ersten Mal).
2. Danach starte ./iniciar.sh fuer taegliche Sessions.

Lokale URL: http://localhost:3000

## Was diese Skripte machen

- INSTALAR.bat / instalar.sh
  - installiert Node-Abhaengigkeiten
  - erstellt Python-Umgebung (.venv)
  - installiert Demucs und noetige Pakete
- INICIAR.bat / iniciar.sh
  - startet die App schnell fuer den taeglichen Einsatz

## Workflow zum Trennen eines Songs

1. Ziehe eine WAV-, MP3-, FLAC- oder AIFF-Datei hinein, oder fuege einen YouTube-Link ein.
2. Waehle den Trennmodus.
   - 4 stems: Gesang, Drums, Bass, Andere (schneller)
   - 6 stems: Gesang, Drums, Bass, Gitarre, Piano, Andere (mehr Details)
3. Starte die Verarbeitung.
4. Vorhoeren, mischen und jede Spur herunterladen.

## Lokaler Motor vs Cloud-Motor

- Lokal (empfohlen): verarbeitet auf deinem Rechner mit Demucs.
- Cloud (optional): nutzt einen entfernten Modal-Endpoint als Backup.

## Geschaetzte Performance

- NVIDIA GPU (CUDA): 30 bis 60 Sekunden pro Song.
- Nur CPU: 5 bis 10 Minuten pro Song.

## Fuer Entwickler (Kurzfassung)

### Skripte

- npm run dev
- npm run dev:clean
- npm run build
- npm run start
- npm run serve
- npm run lint

### API

- POST /api/separate
- GET /api/stems/:runId/:stem

### Wichtige Dateien

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Weitere Guides

- Hauptindex: [README.md](README.md)
- DJ-Schnellguide: [GUIA-DJS.md](GUIA-DJS.md)

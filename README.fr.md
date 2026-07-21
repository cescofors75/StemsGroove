# Open Stems Separator - Guide en Francais

Outil de separation de stems pour DJs et producteurs. Transforme une chanson complete en pistes pour remix, mashup, edits et pratique.

## Demarrage rapide (recommande)

Pense pour la cabine et le studio: installation une fois, lancement en un clic.

### Windows

1. Execute INSTALAR.bat (seulement la premiere fois).
2. Ensuite execute INICIAR.bat pour les sessions quotidiennes.

### macOS / Linux

1. Execute ./instalar.sh (seulement la premiere fois).
2. Ensuite execute ./iniciar.sh pour les sessions quotidiennes.

URL locale: http://localhost:3000

## Ce que font ces scripts

- INSTALAR.bat / instalar.sh
  - installe les dependances Node
  - cree un environnement Python (.venv)
  - installe Demucs et les paquets necessaires
- INICIAR.bat / iniciar.sh
  - demarre l'app rapidement pour usage quotidien

## Workflow pour separer un morceau

1. Glisse un fichier WAV, MP3, FLAC ou AIFF, ou colle un lien YouTube.
2. Choisis le mode de separation.
   - 4 stems: voix, batterie, basse, autres (plus rapide)
   - 6 stems: voix, batterie, basse, guitare, piano, autres (plus de detail)
3. Lance le traitement.
4. Ecoute, mixe et telecharge chaque piste.

## Moteur local vs moteur cloud

- Local (recommande): traite sur ta machine avec Demucs.
- Cloud (optionnel): utilise un endpoint Modal distant comme secours.

## Performance estimee

- GPU NVIDIA (CUDA): 30 a 60 secondes par morceau.
- CPU seulement: 5 a 10 minutes par morceau.

## Pour developpeurs (resume)

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

### Fichiers cles

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Autres guides

- Index principal: [README.md](README.md)
- Guide DJ rapide: [GUIA-DJS.md](GUIA-DJS.md)

# Open Stems Separator - Euskara Gida

DJ eta ekoizleentzako stems banaketa tresna. Abesti oso bat pista banatuetan bihurtzen du remix, mashup, edit eta praktikarako.

## Hasiera azkarra (gomendatua)

Kabina eta estudiorako pentsatua: behin instalatu, egunero klik batekin abiatu.

### Windows

1. Exekutatu INSTALAR.bat (lehen aldian bakarrik).
2. Ondoren exekutatu INICIAR.bat eguneroko saioetan.

### macOS / Linux

1. Exekutatu ./instalar.sh (lehen aldian bakarrik).
2. Ondoren exekutatu ./iniciar.sh eguneroko saioetan.

Helbidea: http://localhost:3000

## Script hauek zer egiten dute

- INSTALAR.bat / instalar.sh
  - Node mendekotasunak instalatzen ditu
  - Python ingurune birtuala sortzen du (.venv)
  - Demucs eta beharrezko paketeak instalatzen ditu
- INICIAR.bat / iniciar.sh
  - aplikazioa azkar abiarazten du eguneroko erabilerarako

## Abesti bat banatzeko fluxua

1. Arrastatu WAV, MP3, FLAC edo AIFF fitxategi bat, edo itsatsi YouTube esteka.
2. Aukeratu banaketa modua.
   - 4 stems: ahotsa, bateria, baxua, besteak (azkarragoa)
   - 6 stems: ahotsa, bateria, baxua, gitarra, pianoa, besteak (xehetasun handiagoa)
3. Prozesatu abestia.
4. Entzun, nahasi eta deskargatu pista bakoitza.

## Motor lokala vs hodeiko motorra

- Lokala (gomendatua): Demucs zure ordenagailuan exekutatzen da.
- Hodeia (aukerakoa): urruneko Modal endpoint bat erabiltzen du backup gisa.

## Errendimendu orientagarria

- NVIDIA GPU (CUDA): 30 eta 60 segundo abesti bakoitzeko.
- CPU bakarrik: 5 eta 10 minutu abesti bakoitzeko.

## Garatzaileentzat (laburra)

### Scriptak

- npm run dev
- npm run dev:clean
- npm run build
- npm run start
- npm run serve
- npm run lint

### API

- POST /api/separate
- GET /api/stems/:runId/:stem

### Fitxategi nagusiak

- app/page.jsx
- app/api/separate/route.js
- app/api/stems/[runId]/[stem]/route.js
- lib/local-separator.js
- lib/modal-separator.js
- lib/i18n.js

## Beste gidak

- Indize nagusia: [README.md](README.md)
- DJ gida azkarra: [GUIA-DJS.md](GUIA-DJS.md)

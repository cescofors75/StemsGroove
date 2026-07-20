#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  STEMSGROOVE - Instalador para DJs / Productores"
echo "============================================"
echo
echo "Este instalador deja StemsGroove funcionando 100% en tu"
echo "ordenador. Una vez instalado NO necesitas internet para"
echo "separar tus tracks en voz, bateria, bajo, etc."
echo

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] No se encontro Node.js."
  echo "Instalalo desde https://nodejs.org/ (version LTS) y vuelve a ejecutar ./instalar.sh"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[AVISO] No se encontro Python 3."
  if command -v brew >/dev/null 2>&1; then
    echo "Instalando Python con Homebrew..."
    brew install python@3.12
  else
    echo "Instala Python 3.12 desde https://www.python.org/downloads/ y vuelve a ejecutar ./instalar.sh"
    exit 1
  fi
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[AVISO] No se encontro FFmpeg."
  if command -v brew >/dev/null 2>&1; then
    echo "Instalando FFmpeg con Homebrew..."
    brew install ffmpeg
  else
    echo "Instala FFmpeg (https://ffmpeg.org/download.html) y vuelve a ejecutar ./instalar.sh"
  fi
fi

echo
echo "[1/4] Instalando la aplicacion (Node.js)..."
npm install

echo
echo "[2/4] Creando el entorno Python local (.venv)..."
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

echo
echo "[3/4] Instalando el motor de separacion Demucs..."
echo "      (puede tardar varios minutos la primera vez)"
".venv/bin/python3" -m pip install --upgrade pip
".venv/bin/python3" -m pip install demucs

echo
read -r -p "Tienes GPU NVIDIA y quieres separar mas rapido con CUDA? [s/N] " usegpu
if [[ "$usegpu" =~ ^[sS]$ ]]; then
  echo "Instalando PyTorch con soporte CUDA..."
  ".venv/bin/python3" -m pip install --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu121
fi

echo
echo "[4/4] Instalacion completa. Abriendo StemsGroove..."
echo "      La app queda funcionando en http://localhost:3000"
echo "      Deja esta terminal abierta mientras la usas."
echo "      Para volver a abrirla otro dia, usa ./iniciar.sh"
echo

( sleep 2; open_browser "http://localhost:3000" ) &
npm run dev

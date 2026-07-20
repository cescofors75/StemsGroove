#!/usr/bin/env bash
cd "$(dirname "$0")"

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1"
  fi
}

if [ ! -f ".venv/bin/python3" ]; then
  echo "No se encontro el motor local instalado."
  echo "Ejecuta primero ./instalar.sh"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "No se encontraron las dependencias de la app."
  echo "Ejecuta primero ./instalar.sh"
  exit 1
fi

echo "Abriendo StemsGroove en http://localhost:3000 ..."
echo "Deja esta terminal abierta mientras la usas."
( sleep 2; open_browser "http://localhost:3000" ) &
npm run dev

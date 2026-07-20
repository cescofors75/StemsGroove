@echo off
title StemsGroove
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo No se encontro el motor local instalado.
  echo Ejecuta primero INSTALAR.bat
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo No se encontraron las dependencias de la app.
  echo Ejecuta primero INSTALAR.bat
  pause
  exit /b 1
)

echo Abriendo StemsGroove en http://localhost:3000 ...
echo Deja esta ventana abierta mientras la usas.
timeout /t 2 >nul
start "" http://localhost:3000
call npm run dev

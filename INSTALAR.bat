@echo off
setlocal enabledelayedexpansion
title StemsGroove - Instalador
cd /d "%~dp0"

echo ============================================
echo   STEMSGROOVE - Instalador para DJs / Productores
echo ============================================
echo.
echo Este instalador deja StemsGroove funcionando 100%% en tu
echo ordenador. Una vez instalado NO necesitas internet para
echo separar tus tracks en voz, bateria, bajo, etc.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js en tu sistema.
  echo Descargalo e instalalo desde: https://nodejs.org/  ^(version LTS^)
  echo Despues de instalarlo, vuelve a ejecutar INSTALAR.bat
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [AVISO] No se encontro Python en tu sistema.
  echo Instalando Python 3.12 con winget, espera un momento...
  winget install -e --id Python.Python.3.12
  echo.
  echo Cierra esta ventana y vuelve a ejecutar INSTALAR.bat
  echo para que los cambios de PATH surtan efecto.
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [AVISO] No se encontro FFmpeg en tu sistema.
  echo Instalando FFmpeg con winget, espera un momento...
  winget install -e --id Gyan.FFmpeg
  echo Si el instalador falla mas abajo, reinicia esta terminal
  echo para que FFmpeg quede disponible en el PATH.
)

echo.
echo [1/4] Instalando la aplicacion (Node.js)...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion de dependencias de Node.
  pause
  exit /b 1
)

echo.
echo [2/4] Creando el entorno Python local (.venv)...
if not exist ".venv" (
  python -m venv .venv
)

echo.
echo [3/4] Instalando el motor de separacion Demucs...
echo       (puede tardar varios minutos la primera vez)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install "numpy<2" demucs
if errorlevel 1 (
  echo [ERROR] No se pudo instalar Demucs. Revisa tu conexion a internet
  echo e intenta ejecutar INSTALAR.bat de nuevo.
  pause
  exit /b 1
)

echo.
set /p usegpu=Tienes una tarjeta grafica NVIDIA y quieres separar mas rapido con CUDA? [s/N]
if /i "%usegpu%"=="s" (
  echo Instalando PyTorch con soporte CUDA...
  ".venv\Scripts\python.exe" -m pip install --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu121
)

echo.
echo [4/4] Instalacion completa. Abriendo StemsGroove...
echo       La app queda funcionando en http://localhost:3000
echo       Deja esta ventana abierta mientras la usas.
echo       Para volver a abrirla otro dia, usa INICIAR.bat
echo.
timeout /t 2 >nul
start "" http://localhost:3000
call npm run dev

# StemsGroove para DJs y Productores 🎧

Guía rápida, sin tecnicismos, para separar cualquier canción en voz,
batería, bajo y más — en tu propio ordenador, sin depender de internet
ni de servicios en la nube.

## ¿Qué hace esta app?

Subes una canción (o pegas un enlace de YouTube) y StemsGroove te
devuelve las pistas por separado:

- 🎤 **Voz**
- 🥁 **Batería**
- 🎸 **Bajo**
- 🎹 **Otros instrumentos** (y opcionalmente guitarra y piano aparte)

Sirve para hacer acapellas, mashups, remixes, quitar la voz de un
track, extraer el bajo para un edit, o preparar stems para tus sets.

## Instalación (solo la primera vez)

Necesitas tener instalado, una sola vez:

- **Node.js** (LTS) → https://nodejs.org/
- **Python 3.12** → https://www.python.org/downloads/ (en Windows, el
  instalador puede hacerlo por ti automáticamente)
- **FFmpeg** (el instalador también intenta instalarlo por ti)

Después:

### Windows

1. Descarga o clona esta carpeta en tu ordenador.
2. Haz doble clic en **`INSTALAR.bat`**.
3. Sigue las instrucciones en pantalla (dile que sí si te pregunta si
   tienes tarjeta gráfica NVIDIA — así separa mucho más rápido).
4. Cuando termine, la app se abre sola en tu navegador.

### macOS / Linux

1. Abre una terminal en esta carpeta.
2. Ejecuta:
   ```bash
   ./instalar.sh
   ```
3. Sigue las instrucciones en pantalla.
4. Cuando termine, la app se abre sola en tu navegador.

La primera instalación puede tardar varios minutos (está descargando
el motor de separación de audio). Es normal.

## Uso diario (después de instalar)

- **Windows:** doble clic en **`INICIAR.bat`**.
- **macOS/Linux:** ejecuta `./iniciar.sh`.

Se abre `http://localhost:3000` en tu navegador. Deja la ventana de
la terminal abierta mientras trabajas — es lo que hace funcionar la
app en tu equipo.

## Cómo separar una canción

1. Arrastra tu archivo de audio (WAV, MP3, FLAC o AIFF) a la zona de
   carga, o pega un enlace de YouTube.
2. Elige el modo:
   - **6S** → 6 pistas (voz, batería, bajo, guitarra, piano, otros)
   - **4S** → 4 pistas (voz, batería, bajo, otros) — más rápido
3. Elige el motor:
   - **LOCAL (sin internet)** → recomendado. Usa tu propio ordenador,
     no sube tu audio a ningún sitio, funciona sin conexión.
   - **NUBE** → usa un servidor remoto (Modal). Solo tiene sentido si
     no pudiste instalar el motor local o tu equipo es muy limitado.
4. Pulsa **PROCESS** y espera. Con GPU NVIDIA: ~30-60 segundos por
   canción. Solo con CPU: ~5-10 minutos.
5. Descarga cada pista o mézclalas en vivo dentro de la propia app.

## ¿Por qué "modo local"?

- **Privacidad**: tu música nunca sale de tu ordenador.
- **Sin límites ni esperas de servidores compartidos.**
- **Funciona sin wifi** una vez instalado (salvo para descargar de
  YouTube, que sí necesita conexión).

## Problemas frecuentes

- **"El motor local no está instalado"**: vuelve a ejecutar
  `INSTALAR.bat` / `instalar.sh`.
- **Va lento**: sin GPU NVIDIA, Demucs usa la CPU y tarda varios
  minutos por canción — es normal, dale tiempo. Si tienes GPU NVIDIA
  y no la usaste al instalar, vuelve a ejecutar el instalador y
  acepta la opción CUDA.
- **No abre el navegador solo**: entra manualmente a
  `http://localhost:3000` mientras la ventana de la terminal siga
  abierta.

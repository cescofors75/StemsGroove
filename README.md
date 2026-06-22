<div align="center">

# 🎚️ STEMS — Four-Stem Separator (Local / On-Device)

**Split any WAV or MP3 track into Vocals · Drums · Bass · Other**
*HTDemucs running 100% in the browser (WebGPU → WASM fallback) · Built with Next.js 15*

![preview](preview.png)

</div>

---

## ✨ Features

- 🎤 **Vocals** — lead and backing vocals isolated
- 🥁 **Drums** — kick, snare, hats and all percussion
- 🎸 **Bass** — bass guitar and low-frequency content
- 🎹 **Other** — guitars, synths and remaining layers
- 🔒 **100% local / on-device** — the HTDemucs ONNX model runs in your browser. **No audio ever leaves your machine**, there is no backend separation service.
- ⚡ **WebGPU accelerated** — automatically uses WebGPU when available and falls back to WASM.
- 🎛️ **Mix editor** — trim, fade in/out and preview before separating. **No selection length limit** — process the whole track.
- 🎵 **Sequencer pattern view** — visual beat grid extracted from each stem, with BPM detection.
- 🔊 **Per-stem volume control** — independent sliders per stem.
- ⬇️ **WAV download** — one click per stem.

> Input is limited to **WAV** and **MP3** uploads. There is no YouTube import and no remote (Modal) processing — those paths were removed in favor of a fully local pipeline.

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | `node --version` |
| A modern browser | — | Chrome/Edge recommended for WebGPU; WASM fallback works everywhere |

No Python, no FFmpeg, no GPU drivers and no cloud account are required — separation happens entirely client-side.

### Install & run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) 🎉

For a stable local production build:

```bash
npm run serve   # next build && next start
```

---

## ⚙️ How it works

```
Browser (your machine)
   │  upload WAV / MP3
   ▼
Mix editor (trim · fade · preview)
   │  build edited WAV (Web Audio)
   ▼
lib/client-demixer.js
   │  decode → STFT → HTDemucs ONNX (WebGPU / WASM) → iSTFT
   ▼
4 × stem WAV (Vocals · Drums · Bass · Other)
   │
   ▼
Players · per-stem volume · sequencer · WAV download
```

The whole separation flow lives in [lib/client-demixer.js](lib/client-demixer.js) and reads its runtime configuration from
[public/models/htdemucs/manifest.json](public/models/htdemucs/manifest.json).

### Model hosting

1. Keep the repository light — do **not** commit the `.onnx` model file.
2. Export the model offline with [tools/export_htdemucs_onnx.py](tools/export_htdemucs_onnx.py).
3. Host the generated `.onnx` on static storage (CDN, GitHub Releases, Hugging Face, Vercel Blob…).
4. Point `modelUrl` in [public/models/htdemucs/manifest.json](public/models/htdemucs/manifest.json) to that URL.
5. Keep [public/models/htdemucs/htdemucs.json](public/models/htdemucs/htdemucs.json) in the repo as lightweight metadata.

This keeps the frontend bundle small while serving the model as a static asset the browser downloads once.

---

## 🗂️ Project Structure

```
StemsGroove/
├── app/
│   ├── page.jsx        # Main UI — upload, editor, separation, players, sequencer
│   ├── layout.jsx
│   └── globals.css
├── lib/
│   ├── client-demixer.js   # Local in-browser HTDemucs pipeline (ONNX + STFT/iSTFT)
│   ├── i18n.js
│   └── themes.js
├── public/models/htdemucs/ # manifest.json + lightweight metadata
├── scripts/dev-solo.cjs    # Dev server launcher
├── tools/                  # ONNX export helper + notes
└── next.config.mjs
```

---

## 🦀 Rust + WASM: evaluation

The heaviest part of [lib/client-demixer.js](lib/client-demixer.js) is the pure-JS DSP around the model — FFT, STFT/iSTFT, windowing, padding and segment overlap-add. The ONNX inference itself already runs in optimized native/WASM/WebGPU kernels via `onnxruntime-web`, so it is **not** the candidate for a rewrite. A focused assessment:

**Where Rust + WASM would help**
- The hand-written radix-2 `fftInPlace`, `stft`, `istft` and the overlap-add loops are O(n·log n) over millions of samples in single-threaded JS. Rust compiled to WASM (with SIMD, and optionally an FFT crate like `rustfft`) would realistically cut that DSP time several-fold and reduce GC pressure from the many `Float32Array`/`Float64Array` allocations.
- Deterministic, allocation-free hot loops are a natural fit for WASM.

**Where it would *not* move the needle**
- Model inference dominates wall-clock time and is already accelerated by ORT. Rust can't speed that up.
- `decodeAudioData`, `URL.createObjectURL` and WAV encoding are browser/IO bound.

**Cost / trade-offs**
- Adds a Rust toolchain + `wasm-pack`/`wasm-bindgen` build step and a `.wasm` artifact to ship and version.
- Data marshalling across the JS↔WASM boundary must be zero-copy (shared memory views) to avoid eating the gains.
- WASM SIMD/threads need the right COOP/COEP headers when threading is enabled.

**Recommendation**
- Worthwhile as a *targeted* optimization: port only the FFT/STFT/iSTFT + overlap-add into a small Rust crate exposing `stft(...)`/`istft(...)` over flat `Float32Array` buffers, keep orchestration and ORT in JS. Start by profiling a real track to confirm the DSP share of total time before investing — if inference is ~80%+ of the time, the user-visible win is modest and may not justify the added build complexity.

---

## 📄 License

MIT

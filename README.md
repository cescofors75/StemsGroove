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

### Optional: quantized (int8) model for the CPU/WASM fallback

WebGPU runs the full-precision model fastest, but on machines where WebGPU is
unavailable (some Windows GPUs/drivers) the app falls back to CPU via WASM,
which is slower for full-precision HTDemucs. An **int8-quantized** model is ~4×
smaller and notably faster on CPU. The WebGPU execution provider does **not**
run int8 graphs well, so the quantized model is used **only on the WASM path**;
WebGPU machines keep using the fp32 model. The selection is automatic.

To enable it:

```bash
# produces public/models/htdemucs/htdemucs.onnx and htdemucs.int8.onnx
python tools/export_htdemucs_onnx.py --model htdemucs --quantize
```

Then host `htdemucs.int8.onnx` on your static storage and point
`modelUrlQuantized` in [public/models/htdemucs/manifest.json](public/models/htdemucs/manifest.json)
at it (leave it `null` to keep fp32 everywhere). The console log prints the
active variant: `engine=WASM ×8 · model=int8 · …`.

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
│   ├── dsp-wasm.js         # Loader/driver for the Rust→WASM DSP core
│   ├── i18n.js
│   └── themes.js
├── rust-dsp/               # Rust crate (FFT/STFT/iSTFT) → WASM + build.sh + verify.mjs
├── public/
│   ├── models/htdemucs/    # manifest.json + lightweight metadata
│   └── wasm/stems_dsp.wasm # compiled DSP core
├── scripts/dev-solo.cjs    # Dev server launcher
├── tools/                  # ONNX export helper + notes
└── next.config.mjs
```

---

## 🦀 Rust + WASM acceleration (STFT / iSTFT)

The FFT-heavy DSP that surrounds the model — radix-2 FFT, STFT/iSTFT, windowing,
padding and the windowed overlap-add reconstruction — has been ported to a small
Rust crate compiled to WebAssembly: [rust-dsp/](rust-dsp/) →
[public/wasm/stems_dsp.wasm](public/wasm/stems_dsp.wasm). Orchestration
(segmenting, overlap weighting) and ONNX inference stay in JS, since inference
already runs in optimized ORT kernels and is not the part Rust can speed up.

**How it's wired**
- [lib/dsp-wasm.js](lib/dsp-wasm.js) loads the module and exposes `stft()` / `istft()`.
- [lib/client-demixer.js](lib/client-demixer.js) calls them through `runStft` / `runIstft`
  dispatchers that **fall back to the pure-JS implementation** when the WASM
  module can't be loaded — so the app keeps working everywhere.

**Design choices**
- No `wasm-bindgen`, no crates.io deps: a single `rustc` invocation builds a
  freestanding `no_std` `cdylib` (~8 KB).
- The module performs only `+ - * /`. The Hann window, FFT twiddle factors and
  the sqrt-based normalization are precomputed in JS and passed in, so no libm /
  transcendental functions are needed inside WASM.
- Buffers live in WASM linear memory addressed by byte offset (**zero-copy** —
  JS reads/writes the same bytes via typed-array views), managed by a tiny bump
  allocator with `mark`/`release` checkpoints.
- Internal math is f64 with f32 storage, mirroring the JS reference exactly.
  `simd128` is enabled so LLVM can vectorize where possible.

**Build & verify**
```bash
rustup target add wasm32-unknown-unknown   # one-time
bash rust-dsp/build.sh                      # → public/wasm/stems_dsp.wasm
node rust-dsp/verify.mjs                     # WASM vs JS reference (expects PASS)
```
The verifier compares WASM output against the JS functions copied from
`client-demixer.js` on a test signal; current max difference is `0.0` (bit-exact).

---

## 📄 License

MIT

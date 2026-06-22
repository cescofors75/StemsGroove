// Browser loader/driver for the Rust→WASM DSP core (public/wasm/stems_dsp.wasm).
//
// The WASM module performs only arithmetic; the Hann window, FFT twiddle factors
// and sqrt-based normalization are precomputed here in JS and passed in. Buffers
// live in WASM linear memory and are addressed by byte offset (zero-copy: we
// write/read the same bytes through typed-array views).
//
// loadDspWasm() returns a backend with stft()/istft() matching the JS reference,
// or null when WASM is unavailable so the caller can fall back to pure JS.

const WASM_URL = "/wasm/stems_dsp.wasm";

function hannWindow(size) {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / size));
  }
  return window;
}

function twiddles(nfft, inverse) {
  const stages = Math.log2(nfft) | 0;
  const tw = new Float64Array(2 * stages);
  const sign = inverse ? 1 : -1;
  let stage = 0;
  for (let blockSize = 2; blockSize <= nfft; blockSize *= 2) {
    const angleStep = (sign * 2 * Math.PI) / blockSize;
    tw[2 * stage] = Math.cos(angleStep);
    tw[2 * stage + 1] = Math.sin(angleStep);
    stage += 1;
  }
  return tw;
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

let loadPromise = null;

export function loadDspWasm() {
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    if (typeof WebAssembly === "undefined" || typeof fetch === "undefined") {
      return null;
    }

    try {
      const response = await fetch(WASM_URL, { cache: "force-cache" });
      if (!response.ok) {
        return null;
      }
      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const ex = instance.exports;
      if (!ex.stft || !ex.istft || !ex.alloc || !ex.memory) {
        return null;
      }
      return createBackend(ex);
    } catch {
      return null;
    }
  })();

  return loadPromise;
}

function createBackend(ex) {
  // Persistent (never-released) allocations for the active nfft.
  let active = null; // { nfft, pWin, pTwFwd, pTwInv, baseMark }

  const f32 = () => new Float32Array(ex.memory.buffer);
  const f64 = () => new Float64Array(ex.memory.buffer);

  function ensureNfft(nfft) {
    if (active && active.nfft === nfft) {
      return active;
    }
    if (!isPowerOfTwo(nfft)) {
      throw new Error(`nfft must be a power of two, got ${nfft}`);
    }
    const stages = Math.log2(nfft) | 0;
    const pWin = ex.alloc(nfft * 8);
    const pTwFwd = ex.alloc(2 * stages * 8);
    const pTwInv = ex.alloc(2 * stages * 8);
    const view = f64();
    view.set(hannWindow(nfft), pWin / 8);
    view.set(twiddles(nfft, false), pTwFwd / 8);
    view.set(twiddles(nfft, true), pTwInv / 8);
    active = { nfft, pWin, pTwFwd, pTwInv, baseMark: ex.mark() };
    return active;
  }

  function stft(signal, nfft, hop) {
    const state = ensureNfft(nfft);
    const numFreqs = nfft / 2 + 1;
    const padSize = nfft / 2;
    const paddedLength = signal.length + 2 * padSize;
    const numFrames = Math.floor((paddedLength - nfft) / hop) + 1;

    const pSig = ex.alloc(signal.length * 4);
    const pRe = ex.alloc(numFreqs * numFrames * 4);
    const pIm = ex.alloc(numFreqs * numFrames * 4);

    f32().set(signal, pSig / 4);

    const frames = ex.stft(
      pSig,
      signal.length,
      nfft,
      hop,
      state.pWin,
      1 / Math.sqrt(nfft),
      state.pTwFwd,
      pRe,
      pIm,
    );

    const view = f32();
    const real = view.slice(pRe / 4, pRe / 4 + numFreqs * frames);
    const imag = view.slice(pIm / 4, pIm / 4 + numFreqs * frames);

    ex.release(state.baseMark);
    return { real, imag, numFreqs, numFrames: frames };
  }

  function istft(real, imag, numFreqs, numFrames, hop, outputLength) {
    const nfft = (numFreqs - 1) * 2;
    const state = ensureNfft(nfft);

    const pRe = ex.alloc(real.length * 4);
    const pIm = ex.alloc(imag.length * 4);
    const pOut = ex.alloc(outputLength * 4);

    const view = f32();
    view.set(real, pRe / 4);
    view.set(imag, pIm / 4);

    ex.istft(
      pRe,
      pIm,
      numFreqs,
      numFrames,
      hop,
      state.pWin,
      Math.sqrt(nfft),
      state.pTwInv,
      pOut,
      outputLength,
    );

    const out = f32().slice(pOut / 4, pOut / 4 + outputLength);
    ex.release(state.baseMark);
    return out;
  }

  return { stft, istft };
}

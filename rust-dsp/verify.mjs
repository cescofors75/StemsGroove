// Numerical verification: WASM stft/istft vs the JS reference in client-demixer.js.
// Run: node rust-dsp/verify.mjs
//
// The JS reference functions below are copied verbatim from lib/client-demixer.js
// so this acts as a regression check that the Rust port reproduces them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ───────────────────────── JS reference (from client-demixer.js) ───────────────────────── */

function bitReversePermutation(size) {
  const bits = Math.log2(size) | 0;
  const permutation = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    let reversed = 0;
    let value = index;
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | (value & 1);
      value >>= 1;
    }
    permutation[index] = reversed;
  }
  return permutation;
}

function fftInPlace(real, imag, inverse) {
  const size = real.length;
  const permutation = bitReversePermutation(size);
  for (let index = 0; index < size; index += 1) {
    const swapped = permutation[index];
    if (swapped > index) {
      let temp = real[index];
      real[index] = real[swapped];
      real[swapped] = temp;
      temp = imag[index];
      imag[index] = imag[swapped];
      imag[swapped] = temp;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let blockSize = 2; blockSize <= size; blockSize *= 2) {
    const half = blockSize / 2;
    const angleStep = (sign * 2 * Math.PI) / blockSize;
    const weightReal = Math.cos(angleStep);
    const weightImag = Math.sin(angleStep);
    for (let start = 0; start < size; start += blockSize) {
      let currentReal = 1;
      let currentImag = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const left = start + offset;
        const right = left + half;
        const tempReal = currentReal * real[right] - currentImag * imag[right];
        const tempImag = currentReal * imag[right] + currentImag * real[right];
        real[right] = real[left] - tempReal;
        imag[right] = imag[left] - tempImag;
        real[left] += tempReal;
        imag[left] += tempImag;
        const nextReal = currentReal * weightReal - currentImag * weightImag;
        const nextImag = currentReal * weightImag + currentImag * weightReal;
        currentReal = nextReal;
        currentImag = nextImag;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imag[index] /= size;
    }
  }
}

function hannWindow(size) {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / size));
  }
  return window;
}

function stftRef(signal, nfft, hopLength) {
  const normFactor = 1 / Math.sqrt(nfft);
  const window = hannWindow(nfft);
  const numFreqs = nfft / 2 + 1;
  const padSize = nfft / 2;
  const paddedLength = signal.length + 2 * padSize;
  const padded = new Float64Array(paddedLength);
  for (let index = 0; index < padSize; index += 1) {
    padded[padSize - 1 - index] = signal[Math.min(index + 1, signal.length - 1)];
  }
  for (let index = 0; index < signal.length; index += 1) {
    padded[padSize + index] = signal[index];
  }
  for (let index = 0; index < padSize; index += 1) {
    padded[padSize + signal.length + index] = signal[Math.max(signal.length - 2 - index, 0)];
  }
  const numFrames = Math.floor((paddedLength - nfft) / hopLength) + 1;
  const real = new Float32Array(numFreqs * numFrames);
  const imag = new Float32Array(numFreqs * numFrames);
  const frameReal = new Float64Array(nfft);
  const frameImag = new Float64Array(nfft);
  for (let frame = 0; frame < numFrames; frame += 1) {
    const offset = frame * hopLength;
    for (let index = 0; index < nfft; index += 1) {
      frameReal[index] = padded[offset + index] * window[index];
      frameImag[index] = 0;
    }
    fftInPlace(frameReal, frameImag, false);
    for (let freq = 0; freq < numFreqs; freq += 1) {
      real[freq * numFrames + frame] = frameReal[freq] * normFactor;
      imag[freq * numFrames + frame] = frameImag[freq] * normFactor;
    }
  }
  return { real, imag, numFreqs, numFrames };
}

function istftRef(real, imag, numFreqs, numFrames, hopLength, outputLength) {
  const nfft = (numFreqs - 1) * 2;
  const normFactor = Math.sqrt(nfft);
  const window = hannWindow(nfft);
  const rawLength = (numFrames - 1) * hopLength + nfft;
  const output = new Float64Array(rawLength);
  const windowNorm = new Float64Array(rawLength);
  const frameReal = new Float64Array(nfft);
  const frameImag = new Float64Array(nfft);
  for (let frame = 0; frame < numFrames; frame += 1) {
    for (let freq = 0; freq < numFreqs; freq += 1) {
      frameReal[freq] = real[freq * numFrames + frame] * normFactor;
      frameImag[freq] = imag[freq * numFrames + frame] * normFactor;
    }
    for (let freq = 1; freq < numFreqs - 1; freq += 1) {
      frameReal[nfft - freq] = frameReal[freq];
      frameImag[nfft - freq] = -frameImag[freq];
    }
    fftInPlace(frameReal, frameImag, true);
    const offset = frame * hopLength;
    for (let index = 0; index < nfft; index += 1) {
      output[offset + index] += frameReal[index] * window[index];
      windowNorm[offset + index] += window[index] * window[index];
    }
  }
  for (let index = 0; index < rawLength; index += 1) {
    if (windowNorm[index] > 1e-8) {
      output[index] /= windowNorm[index];
    }
  }
  const padSize = nfft / 2;
  const result = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    result[index] = output[padSize + index] || 0;
  }
  return result;
}

/* ───────────────────────── WASM driver ───────────────────────── */

const wasmBytes = readFileSync(join(__dirname, "../public/wasm/stems_dsp.wasm"));
const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const ex = instance.exports;

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

function f32view() {
  return new Float32Array(ex.memory.buffer);
}
function f64view() {
  return new Float64Array(ex.memory.buffer);
}

function stftWasm(signal, nfft, hop) {
  const numFreqs = nfft / 2 + 1;
  const padSize = nfft / 2;
  const paddedLength = signal.length + 2 * padSize;
  const numFrames = Math.floor((paddedLength - nfft) / hop) + 1;
  const stages = Math.log2(nfft) | 0;

  const cp = ex.mark();
  const pWin = ex.alloc(nfft * 8);
  const pTw = ex.alloc(2 * stages * 8);
  const pSig = ex.alloc(signal.length * 4);
  const pRe = ex.alloc(numFreqs * numFrames * 4);
  const pIm = ex.alloc(numFreqs * numFrames * 4);

  let f64 = f64view();
  f64.set(hannWindow(nfft), pWin / 8);
  f64.set(twiddles(nfft, false), pTw / 8);
  f32view().set(signal, pSig / 4);

  const frames = ex.stft(pSig, signal.length, nfft, hop, pWin, 1 / Math.sqrt(nfft), pTw, pRe, pIm);

  const f32 = f32view();
  const real = f32.slice(pRe / 4, pRe / 4 + numFreqs * frames);
  const imag = f32.slice(pIm / 4, pIm / 4 + numFreqs * frames);
  ex.release(cp);
  return { real, imag, numFreqs, numFrames: frames };
}

function istftWasm(real, imag, numFreqs, numFrames, hop, outputLength) {
  const nfft = (numFreqs - 1) * 2;
  const stages = Math.log2(nfft) | 0;

  const cp = ex.mark();
  const pWin = ex.alloc(nfft * 8);
  const pTw = ex.alloc(2 * stages * 8);
  const pRe = ex.alloc(real.length * 4);
  const pIm = ex.alloc(imag.length * 4);
  const pOut = ex.alloc(outputLength * 4);

  f64view().set(hannWindow(nfft), pWin / 8);
  f64view().set(twiddles(nfft, true), pTw / 8);
  let f32 = f32view();
  f32.set(real, pRe / 4);
  f32.set(imag, pIm / 4);

  ex.istft(pRe, pIm, numFreqs, numFrames, hop, pWin, Math.sqrt(nfft), pTw, pOut, outputLength);

  const out = f32view().slice(pOut / 4, pOut / 4 + outputLength);
  ex.release(cp);
  return out;
}

/* ───────────────────────── compare ───────────────────────── */

function maxAbsDiff(a, b) {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

const NFFT = 4096;
const HOP = 1024;
let fail = false;

// --- STFT ---
{
  const len = 12000;
  const signal = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    signal[i] = Math.sin(i * 0.013) * 0.6 + (Math.random() * 2 - 1) * 0.2;
  }
  const ref = stftRef(signal, NFFT, HOP);
  const got = stftWasm(signal, NFFT, HOP);
  const dRe = maxAbsDiff(ref.real, got.real);
  const dIm = maxAbsDiff(ref.imag, got.imag);
  const ok = ref.numFrames === got.numFrames && dRe < 1e-4 && dIm < 1e-4;
  console.log(
    `STFT  frames ref=${ref.numFrames} wasm=${got.numFrames}  maxΔreal=${dRe.toExponential(2)}  maxΔimag=${dIm.toExponential(2)}  ${ok ? "OK" : "FAIL"}`,
  );
  if (!ok) fail = true;

  // --- iSTFT (round-trips the spectra produced above) ---
  const outLen = len + NFFT;
  const r2 = istftRef(ref.real, ref.imag, ref.numFreqs, ref.numFrames, HOP, outLen);
  const g2 = istftWasm(got.real, got.imag, got.numFreqs, got.numFrames, HOP, outLen);
  const d2 = maxAbsDiff(r2, g2);
  const ok2 = d2 < 1e-4;
  console.log(`iSTFT len=${outLen}  maxΔ=${d2.toExponential(2)}  ${ok2 ? "OK" : "FAIL"}`);
  if (!ok2) fail = true;
}

console.log(fail ? "\nRESULT: FAIL" : "\nRESULT: PASS");
process.exit(fail ? 1 : 0);

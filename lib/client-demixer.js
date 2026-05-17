const DEFAULT_MANIFEST_URL = "/models/htdemucs/manifest.json";
const REQUIRED_STEMS = ["vocals", "drums", "bass", "other"];
const SHIFTS = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("El manifiesto del demixer cliente no es valido.");
  }

  if (!manifest.enabled) {
    throw new Error("El demixer cliente esta desactivado porque aun no hay un modelo ONNX configurado.");
  }

  if (!manifest.modelUrl || typeof manifest.modelUrl !== "string") {
    throw new Error("Falta modelUrl en el manifiesto del demixer cliente.");
  }

  if (!manifest.metaUrl || typeof manifest.metaUrl !== "string") {
    throw new Error("Falta metaUrl en el manifiesto del demixer cliente.");
  }

  const stems = Array.isArray(manifest.stems) ? manifest.stems : [];
  for (const stem of REQUIRED_STEMS) {
    if (!stems.includes(stem)) {
      throw new Error(`El manifiesto del demixer cliente no declara el stem requerido: ${stem}.`);
    }
  }

  return manifest;
}

function validateMeta(meta) {
  if (!meta || typeof meta !== "object") {
    throw new Error("La metadata del modelo HTDemucs no es valida.");
  }

  const requiredNumbers = ["samplerate", "segment_samples", "hop_length", "nfft"];
  for (const field of requiredNumbers) {
    if (!Number.isFinite(meta[field]) || meta[field] <= 0) {
      throw new Error(`La metadata del modelo no define un valor valido para ${field}.`);
    }
  }

  return meta;
}

async function loadOrtRuntime(preferWebGpu = true) {
  if (preferWebGpu) {
    try {
      return await import("onnxruntime-web/webgpu");
    } catch {
      return import("onnxruntime-web");
    }
  }

  return import("onnxruntime-web");
}

export async function loadClientDemixerManifest(manifestUrl = DEFAULT_MANIFEST_URL) {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar el manifiesto del modelo cliente.");
  }

  const manifest = await response.json();
  return validateManifest(manifest);
}

export async function loadClientDemixerMeta(metaUrl) {
  const response = await fetch(metaUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("No se pudo cargar la metadata del modelo cliente.");
  }

  const meta = await response.json();
  return validateMeta(meta);
}

export async function decodeAudioFile(file, targetSampleRate) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Tu navegador no soporta Web Audio para ejecutar el demixer cliente.");
  }

  const audioContext = new AudioContextClass({ sampleRate: targetSampleRate });
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return decoded;
  } finally {
    await audioContext.close();
  }
}

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
    const angleStep = sign * 2 * Math.PI / blockSize;
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

function stft(signal, nfft, hopLength) {
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

function istft(real, imag, numFreqs, numFrames, hopLength, outputLength) {
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

function htdemucsSpec(signal, params) {
  const { nfft, hop_length: hopLength, num_freq_bins: numFreqBins, spec_time_frames: specTimeFrames, spec_pad: specPad } = params;
  const trimLength = specTimeFrames;
  const inputLength = signal.length;
  const padLeft = specPad;
  const padRight = specPad + trimLength * hopLength - inputLength;
  const padded = new Float32Array(inputLength + padLeft + padRight);

  for (let index = 0; index < padLeft; index += 1) {
    padded[padLeft - 1 - index] = signal[Math.min(index + 1, inputLength - 1)];
  }
  for (let index = 0; index < inputLength; index += 1) {
    padded[padLeft + index] = signal[index];
  }
  for (let index = 0; index < padRight; index += 1) {
    padded[padLeft + inputLength + index] = signal[Math.max(inputLength - 2 - index, 0)];
  }

  const stftResult = stft(padded, nfft, hopLength);
  const real = new Float32Array(numFreqBins * trimLength);
  const imag = new Float32Array(numFreqBins * trimLength);

  for (let freq = 0; freq < numFreqBins; freq += 1) {
    for (let frame = 0; frame < trimLength; frame += 1) {
      const sourceIndex = freq * stftResult.numFrames + (frame + 2);
      real[freq * trimLength + frame] = stftResult.real[sourceIndex];
      imag[freq * trimLength + frame] = stftResult.imag[sourceIndex];
    }
  }

  return { real, imag, numFreqs: numFreqBins, numFrames: trimLength };
}

function specToMagnitude(channelSpecs) {
  const channels = channelSpecs.length;
  const numFreqs = channelSpecs[0].numFreqs;
  const numFrames = channelSpecs[0].numFrames;
  const magnitude = new Float32Array(channels * 2 * numFreqs * numFrames);

  for (let channel = 0; channel < channels; channel += 1) {
    const spec = channelSpecs[channel];
    const realOffset = channel * 2 * numFreqs * numFrames;
    const imagOffset = (channel * 2 + 1) * numFreqs * numFrames;
    for (let index = 0; index < numFreqs * numFrames; index += 1) {
      magnitude[realOffset + index] = spec.real[index];
      magnitude[imagOffset + index] = spec.imag[index];
    }
  }

  return magnitude;
}

function freqOutToWaveform(freqOut, numSources, audioChannels, params, segmentLength) {
  const numFreqBins = params.num_freq_bins;
  const specTimeFrames = params.spec_time_frames;
  const hopLength = params.hop_length;
  const specPad = params.spec_pad;
  const ispecLength = hopLength * Math.ceil(segmentLength / hopLength) + 2 * specPad;
  const result = new Float32Array(numSources * audioChannels * segmentLength);

  for (let source = 0; source < numSources; source += 1) {
    for (let channel = 0; channel < audioChannels; channel += 1) {
      const realIndex = source * audioChannels * 2 + channel * 2;
      const imagIndex = realIndex + 1;
      const paddedFreqs = numFreqBins + 1;
      const paddedFrames = specTimeFrames + 4;
      const paddedReal = new Float32Array(paddedFreqs * paddedFrames);
      const paddedImag = new Float32Array(paddedFreqs * paddedFrames);

      for (let freq = 0; freq < numFreqBins; freq += 1) {
        for (let frame = 0; frame < specTimeFrames; frame += 1) {
          const sourceReal = freqOut[realIndex * numFreqBins * specTimeFrames + freq * specTimeFrames + frame];
          const sourceImag = freqOut[imagIndex * numFreqBins * specTimeFrames + freq * specTimeFrames + frame];
          paddedReal[freq * paddedFrames + frame + 2] = sourceReal;
          paddedImag[freq * paddedFrames + frame + 2] = sourceImag;
        }
      }

      const waveform = istft(paddedReal, paddedImag, paddedFreqs, paddedFrames, hopLength, ispecLength);
      const outputOffset = (source * audioChannels + channel) * segmentLength;
      for (let index = 0; index < segmentLength; index += 1) {
        result[outputOffset + index] = waveform[specPad + index] || 0;
      }
    }
  }

  return result;
}

function createTentWindow(segmentLength) {
  const weight = new Float32Array(segmentLength);
  const half = Math.floor(segmentLength / 2);
  for (let index = 0; index < half; index += 1) {
    weight[index] = (index + 1) / Math.max(1, half);
  }
  for (let index = half; index < segmentLength; index += 1) {
    weight[index] = (segmentLength - index) / Math.max(1, segmentLength - half);
  }
  return weight;
}

function createReflectedPadding(audioData, channels, length, padLength) {
  const totalLength = length + 2 * padLength;
  const padded = new Float32Array(channels * totalLength);

  for (let channel = 0; channel < channels; channel += 1) {
    const sourceOffset = channel * length;
    const targetOffset = channel * totalLength + padLength;
    for (let index = 0; index < length; index += 1) {
      padded[targetOffset + index] = audioData[sourceOffset + index];
    }
    for (let index = 0; index < padLength; index += 1) {
      padded[channel * totalLength + padLength - 1 - index] = audioData[sourceOffset + Math.min(index + 1, length - 1)];
      padded[channel * totalLength + padLength + length + index] = audioData[sourceOffset + Math.max(length - 2 - index, 0)];
    }
  }

  return { padded, totalLength };
}

function interleavedToChannels(data, channels, length, sourceIndex) {
  const result = [];
  for (let channel = 0; channel < channels; channel += 1) {
    const offset = (sourceIndex * channels + channel) * length;
    result.push(data.slice(offset, offset + length));
  }
  return result;
}

function encodeWavBlob(channelData, sampleRate) {
  const channels = channelData.length;
  const numSamples = channelData[0].length;
  const bytesPerSample = 4;
  const dataSize = numSamples * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 32, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < numSamples; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setFloat32(offset, clamp(channelData[channel][index], -1, 1), true);
      offset += 4;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function runSegmentedInference(runtime, audioData, channels, length, onProgress) {
  const { session, meta } = runtime;
  const numSources = meta.sources.length;
  const segmentLength = meta.segment_samples;
  const overlap = 0.25;
  const stride = Math.round((1 - overlap) * segmentLength);
  const weight = createTentWindow(segmentLength);
  const padLength = segmentLength - stride;
  const { padded, totalLength } = createReflectedPadding(audioData, channels, length, padLength);
  const numSegments = Math.max(1, Math.ceil((totalLength - segmentLength) / stride) + 1);
  const output = new Float32Array(numSources * channels * length);
  const sumWeight = new Float32Array(length);

  for (let segment = 0; segment < numSegments; segment += 1) {
    const start = segment * stride;
    const end = Math.min(start + segmentLength, totalLength);
    const actualLength = end - start;
    const segmentMix = new Float32Array(channels * segmentLength);

    for (let channel = 0; channel < channels; channel += 1) {
      const sourceOffset = channel * totalLength + start;
      for (let index = 0; index < actualLength; index += 1) {
        segmentMix[channel * segmentLength + index] = padded[sourceOffset + index];
      }
    }

    const channelSpecs = [];
    for (let channel = 0; channel < channels; channel += 1) {
      channelSpecs.push(
        htdemucsSpec(segmentMix.subarray(channel * segmentLength, (channel + 1) * segmentLength), meta),
      );
    }

    const mag = specToMagnitude(channelSpecs);
    const magTensor = new runtime.ort.Tensor("float32", mag, [1, channels * 2, meta.num_freq_bins, meta.spec_time_frames]);
    const mixTensor = new runtime.ort.Tensor("float32", segmentMix, [1, channels, segmentLength]);
    const results = await session.run({ mag: magTensor, mix: mixTensor });
    const freqOut = results.freq_out.data;
    const timeOut = results.time_out.data;
    const freqWaveform = freqOutToWaveform(freqOut, numSources, channels, meta, segmentLength);
    const outputStart = start - padLength;

    for (let source = 0; source < numSources; source += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const freqOffset = (source * channels + channel) * segmentLength;
        const timeOffset = (source * channels + channel) * segmentLength;
        const bufferOffset = (source * channels + channel) * length;
        for (let index = 0; index < actualLength; index += 1) {
          const outputIndex = outputStart + index;
          if (outputIndex >= 0 && outputIndex < length) {
            output[bufferOffset + outputIndex] += (freqWaveform[freqOffset + index] + timeOut[timeOffset + index]) * weight[index];
          }
        }
      }
    }

    for (let index = 0; index < actualLength; index += 1) {
      const outputIndex = outputStart + index;
      if (outputIndex >= 0 && outputIndex < length) {
        sumWeight[outputIndex] += weight[index];
      }
    }

    onProgress?.({
      phase: "inference",
      progress: 52 + Math.round(((segment + 1) / numSegments) * 35),
      label: `Running HTDemucs segment ${segment + 1}/${numSegments}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  for (let source = 0; source < numSources; source += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = (source * channels + channel) * length;
      for (let index = 0; index < length; index += 1) {
        if (sumWeight[index] > 0) {
          output[offset + index] /= sumWeight[index];
        }
      }
    }
  }

  return output;
}

async function maybeShiftedInference(runtime, stereo, onProgress) {
  const { meta } = runtime;
  const sampleRate = meta.samplerate;
  const channels = 2;
  const length = stereo.length;
  const audioData = new Float32Array(channels * length);
  audioData.set(stereo.left, 0);
  audioData.set(stereo.right, length);

  if (SHIFTS <= 0) {
    return runSegmentedInference(runtime, audioData, channels, length, onProgress);
  }

  const maxShift = Math.floor(0.5 * sampleRate);
  const paddedLength = length + 2 * maxShift;
  const padded = new Float32Array(channels * paddedLength);
  for (let channel = 0; channel < channels; channel += 1) {
    const sourceOffset = channel * length;
    const targetOffset = channel * paddedLength + maxShift;
    for (let index = 0; index < length; index += 1) {
      padded[targetOffset + index] = audioData[sourceOffset + index];
    }
    for (let index = 0; index < maxShift; index += 1) {
      padded[channel * paddedLength + maxShift - 1 - index] = audioData[sourceOffset + Math.min(index + 1, length - 1)];
      padded[channel * paddedLength + maxShift + length + index] = audioData[sourceOffset + Math.max(length - 2 - index, 0)];
    }
  }

  const output = new Float32Array(meta.sources.length * channels * length);
  for (let shift = 0; shift < SHIFTS; shift += 1) {
    const randomOffset = Math.floor(Math.random() * (maxShift + 1));
    const shiftedLength = length + maxShift - randomOffset;
    const shifted = new Float32Array(channels * shiftedLength);
    for (let channel = 0; channel < channels; channel += 1) {
      const sourceOffset = channel * paddedLength + randomOffset;
      const targetOffset = channel * shiftedLength;
      for (let index = 0; index < shiftedLength; index += 1) {
        shifted[targetOffset + index] = padded[sourceOffset + index];
      }
    }

    const shiftedOutput = await runSegmentedInference(runtime, shifted, channels, shiftedLength, onProgress);
    const trimStart = maxShift - randomOffset;
    for (let source = 0; source < meta.sources.length; source += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sourceOffset = (source * channels + channel) * shiftedLength + trimStart;
        const targetOffset = (source * channels + channel) * length;
        for (let index = 0; index < length; index += 1) {
          output[targetOffset + index] += shiftedOutput[sourceOffset + index];
        }
      }
    }
  }

  if (SHIFTS > 1) {
    for (let index = 0; index < output.length; index += 1) {
      output[index] /= SHIFTS;
    }
  }
  return output;
}

export function audioBufferToStereoWaveform(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  if (channelCount === 1) {
    const mono = audioBuffer.getChannelData(0);
    left.set(mono);
    right.set(mono);
    return { left, right, length, sampleRate: audioBuffer.sampleRate };
  }

  left.set(audioBuffer.getChannelData(0));
  right.set(audioBuffer.getChannelData(1));
  return { left, right, length, sampleRate: audioBuffer.sampleRate };
}

export function segmentStereoWaveform(stereo, segmentSamples, overlapSamples = 0) {
  const safeSegmentSamples = Math.max(1, Math.floor(segmentSamples));
  const safeOverlapSamples = clamp(Math.floor(overlapSamples), 0, safeSegmentSamples - 1);
  const stride = Math.max(1, safeSegmentSamples - safeOverlapSamples);
  const segments = [];

  for (let start = 0; start < stereo.length; start += stride) {
    const end = Math.min(stereo.length, start + safeSegmentSamples);
    const left = new Float32Array(safeSegmentSamples);
    const right = new Float32Array(safeSegmentSamples);

    left.set(stereo.left.subarray(start, end));
    right.set(stereo.right.subarray(start, end));

    segments.push({
      start,
      end,
      left,
      right,
      actualLength: end - start,
    });

    if (end >= stereo.length) {
      break;
    }
  }

  return segments;
}

export async function warmupClientDemixer(options = {}) {
  const {
    manifestUrl = DEFAULT_MANIFEST_URL,
    onProgress,
    preferWebGpu = true,
  } = options;

  onProgress?.({ phase: "manifest", progress: 8, label: "Loading client manifest" });
  const manifest = await loadClientDemixerManifest(manifestUrl);
  onProgress?.({ phase: "metadata", progress: 14, label: "Loading model metadata" });
  const meta = await loadClientDemixerMeta(manifest.metaUrl);
  const ort = await loadOrtRuntime(preferWebGpu);

  if (ort.env?.wasm) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
  }

  const executionProviders = preferWebGpu ? ["webgpu", "wasm"] : ["wasm"];
  onProgress?.({ phase: "model", progress: 26, label: "Loading ONNX model" });

  const session = await ort.InferenceSession.create(manifest.modelUrl, {
    executionProviders,
    graphOptimizationLevel: "all",
  });

  onProgress?.({ phase: "ready", progress: 40, label: "HTDemucs ONNX core ready" });
  return { manifest, meta, ort, session };
}

export async function separateTrackInBrowser(file, options = {}) {
  if (!(file instanceof File)) {
    throw new Error("No hay archivo valido para procesar en el navegador.");
  }

  const runtime = await warmupClientDemixer(options);
  const decoded = await decodeAudioFile(file, runtime.meta.samplerate);
  const stereo = audioBufferToStereoWaveform(decoded);
  const overlapSamples = Number.isFinite(runtime.meta.overlap_samples) ? runtime.meta.overlap_samples : 0;
  const segments = segmentStereoWaveform(stereo, runtime.meta.segment_samples, overlapSamples);

  options.onProgress?.({
    phase: "inference",
    progress: 52,
    label: `HTDemucs core loaded; ${segments.length} audio segments prepared`,
  });

  const output = await maybeShiftedInference(runtime, stereo, options.onProgress);
  options.onProgress?.({ phase: "finalize", progress: 92, label: "Encoding separated stems" });

  const stems = {};
  const sampleRate = runtime.meta.samplerate;
  for (let sourceIndex = 0; sourceIndex < runtime.meta.sources.length; sourceIndex += 1) {
    const stemName = runtime.meta.sources[sourceIndex];
    if (!REQUIRED_STEMS.includes(stemName)) {
      continue;
    }
    const channels = interleavedToChannels(output, 2, stereo.length, sourceIndex);
    const wavBlob = encodeWavBlob(channels, sampleRate);
    stems[stemName] = URL.createObjectURL(wavBlob);
  }

  options.onProgress?.({ phase: "done", progress: 100, label: "Client stems ready" });
  return stems;
}

export { DEFAULT_MANIFEST_URL, REQUIRED_STEMS };

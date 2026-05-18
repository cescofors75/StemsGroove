"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { separateTrackViaModal } from "../lib/modal-separator.js";

const STEMS = [
  {
    id: "vocals",
    label: "VOCALS",
    icon: "MIC",
    color: "#e8c547",
    bg: "rgba(232,197,71,0.08)",
    border: "rgba(232,197,71,0.3)",
    desc: "Lead and backing vocals",
  },
  {
    id: "drums",
    label: "DRUMS",
    icon: "DRM",
    color: "#e85447",
    bg: "rgba(232,84,71,0.08)",
    border: "rgba(232,84,71,0.3)",
    desc: "Kick, snare, hats and percussion",
  },
  {
    id: "bass",
    label: "BASS",
    icon: "BSS",
    color: "#47b8e8",
    bg: "rgba(71,184,232,0.08)",
    border: "rgba(71,184,232,0.3)",
    desc: "Bass and low frequency content",
  },
  {
    id: "other",
    label: "OTHER",
    icon: "OTH",
    color: "#78d870",
    bg: "rgba(120,216,112,0.08)",
    border: "rgba(120,216,112,0.3)",
    desc: "Guitars, synths and remaining layers",
  },
];

const ACCEPT_AUDIO = /\.(wav|mp3|flac|aiff?)$/i;

const STEP_MAP = [
  { max: 10, label: "Loading track" },
  { max: 25, label: "Analyzing transients" },
  { max: 50, label: "Running HTDemucs" },
  { max: 75, label: "Reconstructing stems" },
  { max: 95, label: "Finalizing files" },
  { max: 100, label: "Stems ready" },
];

function getStepLabel(progress) {
  return STEP_MAP.find((step) => progress <= step.max)?.label ?? "Processing";
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function normalizeDetectedBpm(bpm, min = 80, max = 190) {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return null;
  }

  let normalized = bpm;
  while (normalized < min) {
    normalized *= 2;
  }
  while (normalized > max) {
    normalized /= 2;
  }

  return normalized;
}

function mixToMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  for (let ch = 0; ch < channels; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }

  return mono;
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawEditorWaveform(canvas, mono, trimStart, trimEnd, duration, previewPosition = null) {
  if (!canvas || !mono?.length || !duration) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.offsetWidth || 720);
  const height = Math.max(1, canvas.offsetHeight || 120);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0, 0, width, height);

  const midY = height / 2;
  const samplesPerPixel = Math.max(1, Math.floor(mono.length / width));
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const start = x * samplesPerPixel;
    const end = Math.min(start + samplesPerPixel, mono.length);
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      peak = Math.max(peak, Math.abs(mono[i]));
    }
    const y = peak * (height * 0.42);
    ctx.moveTo(x + 0.5, midY - y);
    ctx.lineTo(x + 0.5, midY + y);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const startX = (trimStart / duration) * width;
  const endX = (trimEnd / duration) * width;
  const selectionWidth = Math.max(0, endX - startX);

  ctx.fillStyle = "rgba(232,197,71,0.08)";
  ctx.fillRect(startX, 0, selectionWidth, height);

  ctx.fillStyle = "rgba(8,9,11,0.62)";
  ctx.fillRect(0, 0, startX, height);
  ctx.fillRect(endX, 0, Math.max(0, width - endX), height);

  ctx.strokeStyle = "rgba(232,197,71,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, 0);
  ctx.lineTo(startX, height);
  ctx.moveTo(endX, 0);
  ctx.lineTo(endX, height);
  ctx.stroke();

  ctx.fillStyle = "rgba(232,197,71,0.96)";
  ctx.fillRect(startX - 2, 0, 4, height);
  ctx.fillRect(endX - 2, 0, 4, height);

  ctx.fillStyle = "rgba(8,9,11,0.88)";
  ctx.fillRect(startX - 7, midY - 18, 10, 36);
  ctx.fillRect(endX - 3, midY - 18, 10, 36);

  ctx.fillStyle = "rgba(232,197,71,0.98)";
  ctx.fillRect(startX - 3, midY - 10, 2, 20);
  ctx.fillRect(startX + 1, midY - 10, 2, 20);
  ctx.fillRect(endX - 3, midY - 10, 2, 20);
  ctx.fillRect(endX + 1, midY - 10, 2, 20);

  if (Number.isFinite(previewPosition)) {
    const clampedPosition = clamp(previewPosition, 0, duration);
    const playheadX = (clampedPosition / duration) * width;

    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(playheadX + 0.5, 0);
    ctx.lineTo(playheadX + 0.5, height);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX - 4, 7);
    ctx.lineTo(playheadX + 4, 7);
    ctx.closePath();
    ctx.fill();
  }
}

function renderEditedBuffer(sourceBuffer, trimStart, trimEnd, fadeInSeconds, fadeOutSeconds) {
  const sampleRate = sourceBuffer.sampleRate;
  const startSample = Math.max(0, Math.min(sourceBuffer.length - 1, Math.floor(trimStart * sampleRate)));
  const endSample = Math.max(startSample + 1, Math.min(sourceBuffer.length, Math.floor(trimEnd * sampleRate)));
  const frameCount = Math.max(1, endSample - startSample);
  const channelCount = sourceBuffer.numberOfChannels;
  const output = new AudioBuffer({ length: frameCount, numberOfChannels: channelCount, sampleRate });
  const fadeInFrames = Math.min(frameCount, Math.max(0, Math.floor(fadeInSeconds * sampleRate)));
  const fadeOutFrames = Math.min(frameCount, Math.max(0, Math.floor(fadeOutSeconds * sampleRate)));

  for (let channel = 0; channel < channelCount; channel += 1) {
    const input = sourceBuffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    for (let i = 0; i < frameCount; i += 1) {
      let gain = 1;
      if (fadeInFrames > 0 && i < fadeInFrames) {
        gain = Math.min(gain, i / fadeInFrames);
      }
      if (fadeOutFrames > 0 && i >= frameCount - fadeOutFrames) {
        gain = Math.min(gain, (frameCount - i) / fadeOutFrames);
      }
      target[i] = input[startSample + i] * gain;
    }
  }

  return output;
}

function audioBufferToWavBlob(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + length * blockAlign);
  const view = new DataView(buffer);

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * blockAlign, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * blockAlign, true);

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function estimateBpm(mono, sampleRate) {
  const hop = 1024;
  const frameCount = Math.max(1, Math.floor(mono.length / hop));
  const envelope = new Float32Array(frameCount);

  for (let f = 0; f < frameCount; f += 1) {
    const start = f * hop;
    const end = Math.min(start + hop, mono.length);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      sum += Math.abs(mono[i]);
    }
    envelope[f] = sum / Math.max(1, end - start);
  }

  const novelty = [];
  for (let i = 1; i < envelope.length - 1; i += 1) {
    const value = Math.max(0, envelope[i] - envelope[i - 1]);
    novelty.push(value);
  }

  const avg = novelty.reduce((acc, n) => acc + n, 0) / Math.max(1, novelty.length);
  const variance = novelty.reduce((acc, n) => acc + (n - avg) ** 2, 0) / Math.max(1, novelty.length);
  const stdev = Math.sqrt(variance);
  const threshold = avg + stdev * 0.65;

  const onsetTimes = [];
  for (let i = 1; i < novelty.length - 1; i += 1) {
    const isPeak = novelty[i] > novelty[i - 1] && novelty[i] >= novelty[i + 1];
    if (isPeak && novelty[i] > threshold) {
      onsetTimes.push(((i + 1) * hop) / sampleRate);
    }
  }

  const bpmBuckets = new Map();
  for (let i = 1; i < onsetTimes.length; i += 1) {
    for (let back = 1; back <= 4 && i - back >= 0; back += 1) {
      const interval = (onsetTimes[i] - onsetTimes[i - back]) / back;
      if (interval < 0.08 || interval > 1.5) {
        continue;
      }

      const normalized = normalizeDetectedBpm(60 / interval, 80, 190);
      if (!normalized) {
        continue;
      }

      const bucket = Math.round(normalized);
      bpmBuckets.set(bucket, (bpmBuckets.get(bucket) || 0) + 1 / back);
    }
  }

  const bestBucket = [...bpmBuckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 120;
  const bpm = normalizeDetectedBpm(bestBucket, 80, 190);
  return bpm || 120;
}

function getPatternWindow(totalSeconds, bpm, steps = 16, bars = 1) {
  const beatDuration = 60 / Math.max(1, bpm);
  const barDuration = beatDuration * 4 * bars;
  const analysisDuration = Math.max(0.5, Math.min(barDuration, totalSeconds));
  const stepDuration = analysisDuration / steps;
  return { analysisDuration, stepDuration };
}

function detectStemOnsets(mono, sampleRate, analysisDuration) {
  const frameSize = 1024;
  const hopSize = 512;
  const maxSamples = Math.min(mono.length, Math.floor(analysisDuration * sampleRate));
  const frameCount = Math.max(1, Math.floor((maxSamples - frameSize) / hopSize));
  const envelope = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    const end = Math.min(start + frameSize, maxSamples);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      sum += mono[i] * mono[i];
    }
    envelope.push(Math.sqrt(sum / Math.max(1, end - start)));
  }

  if (envelope.length < 3) {
    return [];
  }

  const novelty = [];
  for (let i = 1; i < envelope.length; i += 1) {
    novelty.push(Math.max(0, envelope[i] - envelope[i - 1]));
  }

  const avg = novelty.reduce((acc, value) => acc + value, 0) / Math.max(1, novelty.length);
  const variance = novelty.reduce((acc, value) => acc + (value - avg) ** 2, 0) / Math.max(1, novelty.length);
  const stdev = Math.sqrt(variance);
  const threshold = avg + stdev * 0.9;
  const minGapFrames = Math.max(1, Math.round((sampleRate * 0.06) / hopSize));
  const onsets = [];
  let lastFrame = -minGapFrames;

  for (let i = 1; i < novelty.length - 1; i += 1) {
    const isPeak = novelty[i] > novelty[i - 1] && novelty[i] >= novelty[i + 1];
    if (!isPeak || novelty[i] < threshold || i - lastFrame < minGapFrames) {
      continue;
    }
    lastFrame = i;
    onsets.push(((i + 1) * hopSize) / sampleRate);
  }

  return onsets;
}

function buildStepPattern(mono, sampleRate, bpm, steps = 16, bars = 1) {
  const availableSeconds = mono.length / sampleRate;
  const { analysisDuration, stepDuration } = getPatternWindow(availableSeconds, bpm, steps, bars);
  const onsetTimes = detectStemOnsets(mono, sampleRate, analysisDuration);
  const pattern = Array.from({ length: steps }).map(() => 0);

  for (let step = 0; step < steps; step += 1) {
    const start = Math.floor(step * stepDuration * sampleRate);
    const end = Math.min(mono.length, Math.floor((step + 1) * stepDuration * sampleRate));
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      sum += mono[i] * mono[i];
    }
    pattern[step] = Math.sqrt(sum / Math.max(1, end - start));
  }

  for (const onset of onsetTimes) {
    if (onset < 0 || onset > analysisDuration) {
      continue;
    }
    const step = Math.max(0, Math.min(steps - 1, Math.round(onset / stepDuration)));
    pattern[step] = Math.max(pattern[step], 1);
  }

  const maxValue = Math.max(...pattern, 1e-9);
  return pattern.map((value) => Math.max(0, Math.min(1, value / maxValue)));
}

function countHits(pattern = []) {
  return pattern.reduce((acc, step) => acc + (step >= 0.35 ? 1 : 0), 0);
}

function rotatePattern(pattern = [], shift = 0) {
  if (!pattern.length) {
    return [];
  }
  const steps = pattern.length;
  const offset = ((shift % steps) + steps) % steps;
  return pattern.map((_, index) => pattern[(index - offset + steps) % steps]);
}

function buildEuclideanPattern(steps = 16, pulses = 4, rotation = 0) {
  const normalizedPulses = Math.max(0, Math.min(steps, pulses));
  if (normalizedPulses === 0) {
    return Array.from({ length: steps }).map(() => 0);
  }

  const result = [];
  let bucket = 0;
  for (let i = 0; i < steps; i += 1) {
    bucket += normalizedPulses;
    if (bucket >= steps) {
      bucket -= steps;
      result.push(1);
    } else {
      result.push(0);
    }
  }

  return rotatePattern(result, rotation);
}

function normalizePattern(pattern = []) {
  const maxValue = Math.max(...pattern, 1e-9);
  return pattern.map((step) => Math.max(0, Math.min(1, step / maxValue)));
}

function seededNoise(seed, index) {
  const raw = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453123;
  return raw - Math.floor(raw);
}

function markovMutatePattern(pattern = [], seed = 1, intensity = 0.2) {
  if (!pattern.length) {
    return [];
  }

  const out = [...pattern];
  for (let i = 0; i < out.length; i += 1) {
    const prev = out[(i - 1 + out.length) % out.length];
    const current = out[i];
    const next = out[(i + 1) % out.length];
    const neighborhood = prev + current + next;
    const r = seededNoise(seed, i);

    if (current >= 0.45) {
      const dropChance = 0.06 + intensity * 0.28 - neighborhood * 0.015;
      out[i] = r < dropChance ? current * 0.4 : Math.min(1, current * (1.02 + intensity * 0.2));
    } else {
      const riseChance = 0.03 + intensity * 0.22 + neighborhood * 0.06;
      out[i] = r < riseChance ? Math.max(0.42, current + 0.28 + neighborhood * 0.08) : current * 0.72;
    }
  }

  if (out.every((step) => step < 0.2)) {
    const strongest = pattern.reduce(
      (best, value, index) => (value > best.value ? { value, index } : best),
      { value: -1, index: 0 },
    );
    out[strongest.index] = Math.max(0.65, strongest.value || 0.65);
  }

  return normalizePattern(out);
}

function generatePatternSet(extractedPatterns, seed = 1) {
  if (!extractedPatterns || !Object.keys(extractedPatterns).length) {
    return {};
  }

  const generated = {};
  const stepCount = extractedPatterns.original?.length || extractedPatterns.drums?.length || 32;
  const sourceDrums = extractedPatterns.drums || Array.from({ length: stepCount }).map(() => 0);
  const drumHits = Math.max(3, Math.min(Math.round(stepCount * 0.45), countHits(sourceDrums) || Math.max(4, Math.round(stepCount / 4))));
  const euclidean = buildEuclideanPattern(stepCount, drumHits, seed % stepCount).map((step) => (step ? 0.85 : 0));
  const markovDrums = markovMutatePattern(sourceDrums, 100 + seed, 0.2);

  generated.original = markovMutatePattern(extractedPatterns.original || euclidean, 11 + seed, 0.16);
  generated.drums = normalizePattern(euclidean.map((step, index) => Math.max(step, markovDrums[index] || 0)));
  generated.vocals = markovMutatePattern(extractedPatterns.vocals || generated.original, 23 + seed, 0.24);
  generated.bass = markovMutatePattern(extractedPatterns.bass || generated.original, 37 + seed, 0.18);
  generated.other = markovMutatePattern(extractedPatterns.other || generated.original, 51 + seed, 0.28);

  return generated;
}

// ─── Groove Extractor — pure helpers ─────────────────────────────────────────

function grooveDetectOnsets(buffer, thr) {
  const mono = mixToMono(buffer);
  const primary = detectStemOnsets(mono, buffer.sampleRate, buffer.duration);
  if (primary.length >= 4) {
    return primary;
  }

  const sr = buffer.sampleRate;
  const windowSize = Math.max(256, Math.floor(sr * 0.01));
  const hopSize = Math.max(128, Math.floor(windowSize / 2));
  const minGap = Math.floor(sr * 0.05);
  let prev = 0;
  const fluxValues = [];
  for (let i = 0; i < mono.length - windowSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < windowSize; j += 1) energy += mono[i + j] ** 2;
    energy = Math.sqrt(energy / windowSize);
    const flux = Math.max(0, energy - prev);
    fluxValues.push(flux);
    prev = energy * 0.82 + prev * 0.18;
  }

  const sortedFlux = [...fluxValues].sort((a, b) => a - b);
  const percentileIndex = Math.max(0, Math.min(sortedFlux.length - 1, Math.floor(sortedFlux.length * (0.82 + thr * 0.12))));
  const adaptiveThreshold = sortedFlux[percentileIndex] ?? 0;

  prev = 0;
  let lastOnset = -minGap;
  const found = [];
  for (let i = 0; i < mono.length - windowSize; i += hopSize) {
    let energy = 0;
    for (let j = 0; j < windowSize; j += 1) energy += mono[i + j] ** 2;
    energy = Math.sqrt(energy / windowSize);
    const flux = Math.max(0, energy - prev);
    if (flux >= adaptiveThreshold && i - lastOnset > minGap) {
      found.push(i / sr);
      lastOnset = i;
    }
    prev = energy * 0.82 + prev * 0.18;
  }
  return found;
}

function grooveEstimateBpm(onsets) {
  if (onsets.length < 2) return null;
  const iois = [];
  for (let i = 1; i < onsets.length; i += 1) iois.push(onsets[i] - onsets[i - 1]);
  const sorted = [...iois].sort((a, b) => a - b);
  const bpm = 60 / sorted[Math.floor(sorted.length / 2)];
  const normalized = normalizeDetectedBpm(bpm);
  return normalized ? Math.round(normalized) : null;
}

function grooveDrawWaveform(buffer, canvas) {
  if (!canvas) return;
  const ctx2d = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = 80 * dpr;
  const data = mixToMono(buffer);
  const w = canvas.width;
  const h = canvas.height;
  const step = Math.ceil(data.length / w);
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.strokeStyle = "#5aa3e8";
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  for (let i = 0; i < w; i += 1) {
    let min = 1;
    let max = -1;
    for (let j = 0; j < step; j += 1) {
      const v = data[i * step + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx2d.moveTo(i, ((1 + min) * h) / 2);
    ctx2d.lineTo(i, ((1 + max) * h) / 2);
  }
  ctx2d.stroke();
}

function grooveBuildMap(buffer, bpm, subdivision, thr) {
  const onsets = grooveDetectOnsets(buffer, thr);
  const detectedBpm = grooveEstimateBpm(onsets);
  const activeBpm = detectedBpm || bpm || 120;
  const stepDuration = 60 / activeBpm / (subdivision / 4);
  const numSteps = Math.max(1, Math.round(buffer.duration / stepDuration));
  const map = new Array(numSteps).fill(null);
  const deviations = [];
  for (const onset of onsets) {
    const stepPosition = onset / stepDuration;
    const stepN = Math.max(0, Math.min(numSteps - 1, Math.floor(stepPosition)));
    if (stepN < 0 || stepN >= numSteps) continue;
    const relativePosition = stepPosition - stepN;
    const signedOffset = relativePosition <= 0.5 ? relativePosition : relativePosition - 1;
    const deviationMs = signedOffset * stepDuration * 1000;
    deviations.push(deviationMs);
    if (map[stepN] === null || Math.abs(deviationMs) > Math.abs(map[stepN])) {
      map[stepN] = deviationMs;
    }
  }
  const mapped = map.filter((v) => v !== null);
  const minDev = mapped.length ? Math.min(...mapped) : 0;
  const maxDev = mapped.length ? Math.max(...mapped.map(Math.abs)) : 0;
  const avgDev = mapped.length ? mapped.reduce((a, b) => a + Math.abs(b), 0) / mapped.length : 0;
  const deviationMean = deviations.length ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length : 0;
  const deviationVariance = deviations.length
    ? deviations.reduce((sum, value) => sum + (value - deviationMean) ** 2, 0) / deviations.length
    : 0;
  const deviationStd = Math.sqrt(deviationVariance);
  const uniqueRoundedCount = new Set(mapped.map((value) => Math.round(value))).size;
  const hasUsefulGroove = mapped.length >= 3 && deviationStd >= 3 && uniqueRoundedCount >= 2;
  return {
    map,
    numSteps,
    onsets,
    detectedBpm,
    activeBpm,
    minDev,
    maxDev,
    avgDev,
    mappedCount: mapped.length,
    deviationStd,
    uniqueRoundedCount,
    hasUsefulGroove,
  };
}

function grooveDrawGrid(map, numSteps, canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = 160;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx2d = canvas.getContext("2d");
  ctx2d.scale(dpr, dpr);
  ctx2d.clearRect(0, 0, W, H);
  const blue = "#5aa3e8";
  const blueDark = "#85b7eb";
  const red = "#e07550";
  const redDark = "#f09575";
  const allDevs = map.filter((v) => v !== null);
  const maxAbs = Math.max(...allDevs.map(Math.abs), 10);
  const midY = H / 2;
  const padX = 36;
  const cellW = (W - padX * 2) / numSteps;
  ctx2d.strokeStyle = "rgba(255,255,255,0.1)";
  ctx2d.lineWidth = 0.5;
  ctx2d.beginPath();
  ctx2d.moveTo(padX, midY);
  ctx2d.lineTo(W - padX, midY);
  ctx2d.stroke();
  [10, 20, 30].forEach((ms) => {
    if (ms > maxAbs * 1.1) return;
    const y1 = midY - (ms / maxAbs) * (midY - 14);
    const y2 = midY + (ms / maxAbs) * (midY - 14);
    ctx2d.strokeStyle = "rgba(255,255,255,0.05)";
    ctx2d.setLineDash([3, 3]);
    ctx2d.beginPath();
    ctx2d.moveTo(padX, y1);
    ctx2d.lineTo(W - padX, y1);
    ctx2d.stroke();
    ctx2d.beginPath();
    ctx2d.moveTo(padX, y2);
    ctx2d.lineTo(W - padX, y2);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
    ctx2d.fillStyle = "rgba(255,255,255,0.3)";
    ctx2d.font = "9px monospace";
    ctx2d.fillText(`+${ms}`, 2, y1 + 3);
    ctx2d.fillText(`-${ms}`, 2, y2 + 3);
  });
  for (let i = 0; i < numSteps; i += 1) {
    const x = padX + i * cellW;
    ctx2d.strokeStyle = i % 4 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)";
    ctx2d.lineWidth = i % 4 === 0 ? 0.8 : 0.5;
    ctx2d.beginPath();
    ctx2d.moveTo(x, 8);
    ctx2d.lineTo(x, H - 14);
    ctx2d.stroke();
    const dev = map[i];
    if (dev === null) {
      ctx2d.fillStyle = "rgba(255,255,255,0.04)";
      ctx2d.fillRect(x + 1, midY - 2, Math.max(cellW - 2, 1), 4);
      continue;
    }
    const barH = (Math.abs(dev) / maxAbs) * (midY - 16);
    const isAhead = dev < 0;
    ctx2d.fillStyle = isAhead ? blue : red;
    if (isAhead) {
      ctx2d.fillRect(x + 1, midY - barH, Math.max(cellW - 2, 1), barH);
    } else {
      ctx2d.fillRect(x + 1, midY, Math.max(cellW - 2, 1), barH);
    }
    if (cellW > 14) {
      ctx2d.fillStyle = isAhead ? blueDark : redDark;
      ctx2d.font = "8px monospace";
      ctx2d.textAlign = "center";
      const lbl = dev.toFixed(0);
      if (isAhead) ctx2d.fillText(lbl, x + cellW / 2, midY - barH - 3);
      else ctx2d.fillText(lbl, x + cellW / 2, midY + barH + 9);
      ctx2d.textAlign = "left";
    }
  }
  ctx2d.fillStyle = "rgba(255,255,255,0.3)";
  ctx2d.font = "9px sans-serif";
  for (let i = 0; i < numSteps; i += 4) {
    ctx2d.fillText(i + 1, padX + i * cellW + 1, H - 2);
  }
}

function grooveExportJSON(map, bpm, subdivision) {
  const template = {
    name: "groove_template",
    bpm_source: bpm,
    subdivision,
    steps: map.map((v) => (v === null ? 0 : parseFloat(v.toFixed(2)))),
  };
  grooveDownload("groove_template.json", JSON.stringify(template, null, 2), "application/json");
}

function grooveExportCSV(map) {
  const rows = ["step,deviation_ms"];
  map.forEach((v, i) => rows.push(`${i + 1},${v === null ? 0 : v.toFixed(2)}`));
  grooveDownload("groove_template.csv", rows.join("\n"), "text/csv");
}

function grooveDownload(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildWaveHeights(count, active, tick = 0) {
  return Array.from({ length: count }).map((_, i) => {
    if (active) {
      const phase = tick * 0.33;
      const motion = Math.sin(i * 0.72 + phase) * 14 + Math.cos(i * 0.27 + phase * 0.8) * 8;
      return Math.max(14, Math.min(92, 44 + motion));
    }
    return 18 + Math.sin(i * 0.55) * 8 + Math.cos(i * 0.3) * 5;
  });
}

function AnimatedWaveform({ color, active, small = false }) {
  const [tick, setTick] = useState(0);
  const bars = useMemo(() => buildWaveHeights(small ? 24 : 42, active, tick), [small, active, tick]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick((n) => n + 1), 150);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: small ? 2 : 3, height: small ? 30 : 44 }}>
      {bars.map((height, i) => (
        <div
          key={`${i}-${tick}`}
          style={{
            width: small ? "2px" : "3px",
            height: `${Math.max(8, Math.min(96, height)).toFixed(2)}%`,
            background: active ? color : "rgba(255,255,255,0.18)",
            borderRadius: 2,
            transition: "height 180ms ease",
            animationName: active ? "wavePulse" : "none",
            animationDuration: active ? `${0.6 + (i % 5) * 0.08}s` : "0s",
            animationTimingFunction: "ease-in-out",
            animationIterationCount: "infinite",
            animationDirection: "alternate",
            animationDelay: `${(i % 9) * 0.04}s`,
          }}
        />
      ))}
    </div>
  );
}

function StemCard({
  stem,
  ready,
  playing,
  stemUrl,
  volume,
  onPlay,
  onPause,
  onVolumeChange,
  downloadName,
}) {
  const isPlaying = playing === stem.id;

  return (
    <div
      style={{
        background: ready ? stem.bg : "rgba(255,255,255,0.02)",
        border: `1px solid ${ready ? stem.border : "rgba(255,255,255,0.06)"}`,
        borderRadius: 14,
        padding: "18px 20px",
        transition: "all 0.35s ease",
        opacity: ready ? 1 : 0.42,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              border: `1px solid ${stem.border}`,
              background: "rgba(255,255,255,0.03)",
              color: stem.color,
              borderRadius: 8,
              fontFamily: "'Space Mono', monospace",
              fontSize: 10,
              letterSpacing: 1,
              padding: "5px 7px",
            }}
          >
            {stem.icon}
          </div>
          <div>
            <div
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 11,
                letterSpacing: 2.4,
                color: stem.color,
                fontWeight: 700,
              }}
            >
              {stem.label}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{stem.desc}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {ready && stemUrl && (
            <>
              <button
                type="button"
                onClick={isPlaying ? onPause : () => onPlay(stem.id)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  border: `1.5px solid ${stem.color}`,
                  background: isPlaying ? stem.color : "transparent",
                  color: isPlaying ? "#020202" : stem.color,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                }}
              >
                {isPlaying ? "II" : ">"}
              </button>

              <a
                href={stemUrl}
                download={downloadName}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  border: "1.5px solid rgba(255,255,255,0.28)",
                  color: "rgba(255,255,255,0.82)",
                  background: "rgba(255,255,255,0.02)",
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Download stem"
                aria-label={`Download ${stem.label}`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 4v10m0 0 4-4m-4 4-4-4M5 16.5v1A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-1"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <AnimatedWaveform color={stem.color} active={isPlaying} small />
      </div>

      {ready && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.3)",
              fontFamily: "'Space Mono', monospace",
              width: 24,
            }}
          >
            VOL
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => onVolumeChange(stem.id, Number(event.target.value))}
            style={{
              flex: 1,
              accentColor: stem.color,
              height: "clamp(8px, 0.9vw, 12px)",
              cursor: "pointer",
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.34)",
              fontFamily: "'Space Mono', monospace",
              width: 28,
              textAlign: "right",
            }}
          >
            {volume}%
          </span>
        </div>
      )}
    </div>
  );
}

function ProgressRing({ progress, color }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dash = (progress / 100) * circumference;

  return (
    <svg width={72} height={72} viewBox="0 0 72 72" aria-label="Progress ring">
      <circle cx={36} cy={36} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
      <circle
        cx={36}
        cy={36}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dasharray 0.25s ease" }}
      />
      <text
        x={36}
        y={40}
        textAnchor="middle"
        fill="#ffffff"
        fontSize={12}
        fontFamily="'Space Mono', monospace"
        fontWeight="700"
      >
        {progress}%
      </text>
    </svg>
  );
}

function GrooveExtractor({ stemUrl, stemLabel = "STEM" }) {
  const [collapsed, setCollapsed] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [subdivision, setSubdivision] = useState(16);
  const [threshold, setThreshold] = useState(0.15);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [grooveMap, setGrooveMap] = useState([]);
  const [numSteps, setNumSteps] = useState(0);
  const [stats, setStats] = useState(null);
  const [loadStatus, setLoadStatus] = useState("idle");
  const [loadLabel, setLoadLabel] = useState("");
  const [draggingOver, setDraggingOver] = useState(false);
  const [hasUsefulGroove, setHasUsefulGroove] = useState(false);
  const waveCanvasRef = useRef(null);
  const gridCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadedUrlRef = useRef(null);
  const syncedDetectedBpmRef = useRef(null);

  const GE_ACCENT = "#5aa3e8";

  useEffect(() => {
    if (stemUrl) {
      return;
    }

    setCollapsed(true);
  }, [stemUrl]);

  const loadFromUrl = useCallback(async (url, label) => {
    if (loadedUrlRef.current === url) return;
    setLoadStatus("loading");
    setLoadLabel(label || "stem");
    setStats(null);
    setGrooveMap([]);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const arrayBuffer = await res.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const buf = await ctx.decodeAudioData(arrayBuffer);
      await ctx.close();
      loadedUrlRef.current = url;
      setAudioBuffer(buf);
      setLoadStatus("ready");
    } catch {
      setLoadStatus("error");
    }
  }, []);

  const loadFromFile = useCallback(async (file) => {
    if (!file || !/\.(wav|mp3|flac|ogg|aiff?)$/i.test(file.name)) return;
    setLoadStatus("loading");
    setLoadLabel(file.name);
    setStats(null);
    setGrooveMap([]);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
      await ctx.close();
      loadedUrlRef.current = null;
      setAudioBuffer(buf);
      setLoadStatus("ready");
    } catch {
      setLoadStatus("error");
    }
  }, []);

  // Auto-load current stem when section opens
  useEffect(() => {
    if (!collapsed && stemUrl && loadStatus === "idle") {
      loadFromUrl(stemUrl, stemLabel);
    }
  }, [collapsed, loadStatus, loadFromUrl, stemLabel, stemUrl]);

  // Re-analyze when buffer or params change
  useEffect(() => {
    if (!audioBuffer) return;
    const result = grooveBuildMap(audioBuffer, bpm, subdivision, threshold);
    setGrooveMap(result.map);
    setNumSteps(result.numSteps);
    setHasUsefulGroove(result.hasUsefulGroove);
    setStats({
      onsets: result.onsets.length,
      detectedBpm: result.detectedBpm,
      activeBpm: result.activeBpm,
      minDev: result.minDev,
      maxDev: result.maxDev,
      avgDev: result.avgDev,
      mappedCount: result.mappedCount,
      deviationStd: result.deviationStd,
      uniqueRoundedCount: result.uniqueRoundedCount,
      hasUsefulGroove: result.hasUsefulGroove,
    });
  }, [audioBuffer, bpm, subdivision, threshold]);

  useEffect(() => {
    if (loadStatus === "ready") {
      setCollapsed(!hasUsefulGroove);
    }
  }, [hasUsefulGroove, loadStatus]);

  useEffect(() => {
    if (!audioBuffer) {
      syncedDetectedBpmRef.current = null;
      return;
    }

    const mono = mixToMono(audioBuffer);
    const detected = Math.round(estimateBpm(mono, audioBuffer.sampleRate));
    if (!Number.isFinite(detected) || detected <= 0) {
      return;
    }

    if (syncedDetectedBpmRef.current !== detected) {
      syncedDetectedBpmRef.current = detected;
      setBpm(detected);
    }
  }, [audioBuffer]);

  // Redraw waveform on buffer change
  useEffect(() => {
    if (audioBuffer && waveCanvasRef.current) {
      grooveDrawWaveform(audioBuffer, waveCanvasRef.current);
    }
  }, [audioBuffer]);

  // Redraw grid when map changes
  useEffect(() => {
    if (grooveMap.length && gridCanvasRef.current) {
      grooveDrawGrid(grooveMap, numSteps, gridCanvasRef.current);
    }
  }, [grooveMap, numSteps]);

  const hasResults = loadStatus === "ready" && stats;

  if (loadStatus === "ready" && stats && !hasUsefulGroove) {
    return null;
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.07)",
          cursor: "pointer",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              letterSpacing: 2,
              fontSize: 10,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            GROOVE EXTRACTOR · {stemLabel}
          </span>
          {loadStatus === "ready" && (
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 9,
                color: GE_ACCENT,
                letterSpacing: 1,
              }}
            >
              {loadLabel}
            </span>
          )}
        </div>
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            color: "rgba(255,255,255,0.4)",
          }}
        >
          {collapsed ? "▼" : "▲"}
        </span>
      </button>

      {!collapsed && (
        <div style={{ padding: "16px 18px" }}>
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDraggingOver(true);
            }}
            onDragLeave={() => setDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingOver(false);
              loadFromFile(e.dataTransfer.files[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `1.5px dashed ${draggingOver ? GE_ACCENT : "rgba(255,255,255,0.12)"}`,
              borderRadius: 10,
              padding: "12px 14px",
              textAlign: "center",
              cursor: "pointer",
              background: draggingOver ? "rgba(90,163,232,0.06)" : "rgba(255,255,255,0.01)",
              marginBottom: 14,
              transition: "all 0.2s",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3,.ogg,.aac,.flac,audio/*"
              style={{ display: "none" }}
              onChange={(e) => loadFromFile(e.target.files[0])}
            />
            {loadStatus === "loading" && (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                Cargando {loadLabel}…
              </span>
            )}
            {loadStatus === "error" && (
              <span style={{ fontSize: 12, color: "rgba(232,84,71,0.88)" }}>
                Error cargando. Intenta con otro archivo.
              </span>
            )}
            {loadStatus === "ready" && (
              <span
                style={{
                  fontSize: 12,
                  color: GE_ACCENT,
                  fontFamily: "'Space Mono', monospace",
                }}
              >
                {loadLabel} — haz clic o arrastra para cambiar
              </span>
            )}
            {loadStatus === "idle" && (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
                Arrastra un loop de batería, o haz clic · WAV · MP3 · OGG
              </span>
            )}
          </div>

          {hasResults && (
            <>
              <div
                style={{
                  marginBottom: 12,
                  border: "1px solid rgba(90,163,232,0.22)",
                  background: "rgba(90,163,232,0.07)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 11,
                  color: "rgba(255,255,255,0.68)",
                  lineHeight: 1.5,
                }}
              >
                Este panel analiza el audio real del stem cargado. La rejilla usa el BPM detectado como valor inicial,
                pero sigue siendo sensible a los sliders de BPM, subdivision y threshold.
              </div>

              {!stats.hasUsefulGroove && (
                <div
                  style={{
                    marginBottom: 12,
                    border: "1px solid rgba(232,197,71,0.22)",
                    background: "rgba(232,197,71,0.08)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 11,
                    color: "rgba(255,255,255,0.72)",
                    lineHeight: 1.5,
                  }}
                >
                  Este stem no tiene suficiente variacion real de microtiming para considerarlo un groove util.
                </div>
              )}

              {/* Stats */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {[
                  { n: stats.onsets, l: "onsets" },
                  { n: stats.mappedCount, l: "mapped" },
                  { n: stats.detectedBpm ?? "?", l: "BPM detectado" },
                  { n: stats.activeBpm ? Math.round(stats.activeBpm) : "?", l: "BPM activo" },
                  { n: stats.minDev.toFixed(1), l: "desv. min (ms)" },
                  { n: stats.maxDev.toFixed(1), l: "desv. max (ms)" },
                  { n: stats.avgDev.toFixed(1), l: "desv. media (ms)" },
                  { n: stats.deviationStd.toFixed(1), l: "var. desv. (ms)" },
                ].map(({ n, l }) => (
                  <div
                    key={l}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "0.5px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Space Mono', monospace",
                        fontSize: 18,
                        fontWeight: 700,
                      }}
                    >
                      {n}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                      {l}
                    </div>
                  </div>
                ))}
              </div>

              {/* Waveform canvas */}
              <canvas
                ref={waveCanvasRef}
                style={{
                  width: "100%",
                  height: 80,
                  display: "block",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.02)",
                  border: "0.5px solid rgba(255,255,255,0.08)",
                  marginBottom: 14,
                }}
              />

              {/* Sliders */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                {[
                  { label: "BPM", value: bpm, min: 60, max: 200, step: 1, set: setBpm, fmt: (v) => v },
                  {
                    label: "Subdivisión",
                    value: subdivision,
                    min: 8,
                    max: 32,
                    step: 8,
                    set: setSubdivision,
                    fmt: (v) => v,
                  },
                  {
                    label: "Threshold",
                    value: threshold,
                    min: 0.02,
                    max: 0.5,
                    step: 0.01,
                    set: setThreshold,
                    fmt: (v) => v.toFixed(2),
                  },
                ].map(({ label, value, min, max, step, set, fmt }) => (
                  <div
                    key={label}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "0.5px solid rgba(255,255,255,0.08)",
                      borderRadius: 8,
                      padding: "10px 12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "rgba(255,255,255,0.45)",
                        marginBottom: 8,
                      }}
                    >
                      <span>{label}</span>
                      <span style={{ color: "#fff", fontFamily: "'Space Mono', monospace" }}>
                        {fmt(value)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={value}
                      onChange={(e) =>
                        set(label === "Threshold" ? parseFloat(e.target.value) : parseInt(e.target.value, 10))
                      }
                      style={{
                        width: "100%",
                        accentColor: GE_ACCENT,
                        height: "clamp(8px, 0.9vw, 12px)",
                        cursor: "pointer",
                      }}
                    />
                  </div>
                ))}
              </div>

              {stats.detectedBpm && Math.round(stats.detectedBpm) !== bpm && (
                <div
                  style={{
                    marginTop: -4,
                    marginBottom: 14,
                    fontSize: 11,
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  BPM detectado: {Math.round(stats.detectedBpm)}. BPM de rejilla actual: {bpm}.
                </div>
              )}

              {/* Groove grid */}
              <div
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "0.5px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 14,
                  overflowX: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 10,
                      color: "rgba(255,255,255,0.45)",
                      letterSpacing: 1,
                    }}
                  >
                    REJILLA DE GROOVE — desviación por paso (ms)
                  </span>
                  <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.4)" }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#5aa3e8",
                          display: "inline-block",
                        }}
                      />
                      ahead of beat
                    </span>
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.4)" }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#e07550",
                          display: "inline-block",
                        }}
                      />
                      behind beat
                    </span>
                  </div>
                </div>
                <canvas ref={gridCanvasRef} style={{ width: "100%", height: 160, display: "block" }} />
              </div>

              {/* Export buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => grooveExportJSON(grooveMap, bpm, subdivision)}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "rgba(255,255,255,0.8)",
                    borderRadius: 8,
                    padding: "7px 14px",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "'Space Mono', monospace",
                    letterSpacing: 0.5,
                  }}
                >
                  ↓ JSON template
                </button>
                <button
                  type="button"
                  onClick={() => grooveExportCSV(grooveMap)}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "rgba(255,255,255,0.8)",
                    borderRadius: 8,
                    padding: "7px 14px",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "'Space Mono', monospace",
                    letterSpacing: 0.5,
                  }}
                >
                  ↓ CSV
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function drawGrooveComparison(onsetSeries, canvas, activeStemId) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.offsetWidth || 720);
  const height = 180;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const activeSeries = (onsetSeries || []).filter((item) => item?.selected);
  const maxDuration = Math.max(...activeSeries.map((item) => item.duration || 0), 1);
  const rowHeight = Math.max(28, (height - 24) / Math.max(activeSeries.length, 1));

  activeSeries.forEach((series, index) => {
    const isActive = series.id === activeStemId;
    const y = 16 + index * rowHeight;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0, y - 10, width, 1);
    ctx.fillStyle = isActive ? series.color : "rgba(255,255,255,0.45)";
    ctx.font = isActive ? "700 10px monospace" : "10px monospace";
    ctx.fillText(series.label, 8, y - 2);
    for (const onset of series.onsets || []) {
      const x = 72 + (onset / maxDuration) * Math.max(1, width - 88);
      ctx.strokeStyle = isActive ? series.color : `${series.color}55`;
      ctx.lineWidth = isActive ? 3.2 : 1.5;
      ctx.globalAlpha = isActive ? 1 : 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x, y + rowHeight - 10);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });
}

function drawGrooveDeviationComparison(seriesList, canvas, activeStemId) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.offsetWidth || 720);
  const height = 220;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const activeSeries = (seriesList || []).filter((item) => item?.selected && item?.map?.length);
  const allValues = activeSeries.flatMap((item) => (item.map || []).filter((value) => value !== null).map(Math.abs));
  const maxAbs = Math.max(...allValues, 10);
  const padX = 44;
  const padY = 18;
  const midY = height / 2;
  const stepCount = Math.max(...activeSeries.map((item) => item.map?.length || 0), 16);
  const cellW = (width - padX * 2) / stepCount;

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  ctx.moveTo(padX, midY);
  ctx.lineTo(width - padX, midY);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.font = "10px monospace";
  ctx.fillText("early", 6, 20);
  ctx.fillText("late", 10, height - 12);

  for (let i = 0; i < stepCount; i += 4) {
    const x = padX + i * cellW;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(x, padY);
    ctx.lineTo(x, height - padY);
    ctx.stroke();
  }

  activeSeries.forEach((series, index) => {
    const isActive = series.id === activeStemId;
    const legendX = padX + index * 118;
    if (legendX > width - 110) {
      return;
    }
    ctx.globalAlpha = isActive ? 1 : 0.45;
    ctx.fillStyle = series.color;
    ctx.fillRect(legendX, 6, 14, isActive ? 4 : 3);
    ctx.font = isActive ? "700 10px monospace" : "10px monospace";
    ctx.fillText(series.label, legendX + 20, 10);
    ctx.globalAlpha = 1;
  });

  activeSeries.forEach((series) => {
    const isActive = series.id === activeStemId;
    ctx.strokeStyle = isActive ? series.color : `${series.color}66`;
    ctx.lineWidth = isActive ? 2.8 : 1.2;
    ctx.globalAlpha = isActive ? 1 : 0.32;
    ctx.beginPath();
    let started = false;
    (series.map || []).forEach((value, index) => {
      if (value === null) {
        started = false;
        return;
      }
      const x = padX + index * cellW + cellW / 2;
      const y = midY - (value / maxAbs) * (midY - padY - 8);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function GrooveComparison({ stemUrls }) {
  const [collapsed, setCollapsed] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [subdivision, setSubdivision] = useState(16);
  const [threshold, setThreshold] = useState(0.15);
  const [grooveData, setGrooveData] = useState({});
  const [selectedStems, setSelectedStems] = useState({ drums: true, bass: true, vocals: true, other: true });
  const [activeStemId, setActiveStemId] = useState("drums");
  const comparisonCanvasRef = useRef(null);
  const deviationCanvasRef = useRef(null);

  const availableStems = useMemo(() => STEMS.filter((stem) => stemUrls?.[stem.id]), [stemUrls]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const nextData = {};
      for (const stem of availableStems) {
        try {
          const res = await fetch(stemUrls[stem.id]);
          if (!res.ok) {
            continue;
          }
          const arrayBuffer = await res.arrayBuffer();
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioCtx();
          const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
          await ctx.close();
          const mono = mixToMono(buffer);
          const detected = Math.round(estimateBpm(mono, buffer.sampleRate));
          const analysis = grooveBuildMap(buffer, detected, subdivision, threshold);
          const confidence = !analysis.hasUsefulGroove
            ? "baja"
            : analysis.deviationStd >= 8 && analysis.mappedCount >= 8
              ? "alta"
              : "media";
          nextData[stem.id] = {
            ...stem,
            duration: buffer.duration,
            onsets: analysis.onsets,
            map: analysis.map,
            stats: analysis,
            confidence,
          };
        } catch {
          nextData[stem.id] = {
            ...stem,
            duration: 0,
            onsets: [],
            map: [],
            stats: { mappedCount: 0, onsets: [], hasUsefulGroove: false, detectedBpm: null, activeBpm: null, minDev: 0, maxDev: 0, avgDev: 0, deviationStd: 0 },
            confidence: "baja",
          };
        }
      }
      if (!cancelled) {
        setGrooveData(nextData);
        const useful = Object.fromEntries(availableStems.map((stem) => [stem.id, nextData[stem.id]?.stats?.hasUsefulGroove ?? false]));
        setSelectedStems((prev) => ({ ...prev, ...useful }));
        const firstUseful = availableStems.find((stem) => useful[stem.id]);
        if (firstUseful) {
          setActiveStemId((prev) => (useful[prev] ? prev : firstUseful.id));
        }
        if (Object.values(useful).some(Boolean)) {
          setCollapsed(false);
        }
      }
    };

    if (availableStems.length) {
      load();
    }

    return () => {
      cancelled = true;
    };
  }, [availableStems, stemUrls, subdivision, threshold]);

  const selectedSeries = useMemo(
    () =>
      availableStems.map((stem) => ({
        ...(grooveData[stem.id] || {}),
        id: stem.id,
        label: grooveData[stem.id]?.label || stem.label,
        color: grooveData[stem.id]?.color || stem.color,
        onsets: grooveData[stem.id]?.onsets || [],
        map: grooveData[stem.id]?.map || [],
        stats:
          grooveData[stem.id]?.stats ||
          {
            mappedCount: 0,
            onsets: [],
            hasUsefulGroove: false,
            detectedBpm: null,
            activeBpm: null,
            minDev: 0,
            maxDev: 0,
            avgDev: 0,
            deviationStd: 0,
          },
        confidence: grooveData[stem.id]?.confidence || "baja",
        duration: grooveData[stem.id]?.duration || 0,
        selected: !!selectedStems[stem.id],
      })),
    [availableStems, grooveData, selectedStems],
  );

  useEffect(() => {
    drawGrooveComparison(selectedSeries, comparisonCanvasRef.current, activeStemId);
    drawGrooveDeviationComparison(selectedSeries, deviationCanvasRef.current, activeStemId);
  }, [activeStemId, selectedSeries]);

  const selectedUseful = selectedSeries.filter((item) => item?.selected && item?.stats?.hasUsefulGroove);
  const activeStem = selectedSeries.find((item) => item?.id === activeStemId && item?.selected && item?.stats?.hasUsefulGroove) || selectedUseful[0] || null;

  if (!availableStems.length) {
    return null;
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        style={{ width: "100%", background: "transparent", border: "none", borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.07)", cursor: "pointer", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", color: "inherit" }}
      >
        <span style={{ fontFamily: "'Space Mono', monospace", letterSpacing: 2, fontSize: 10, color: "rgba(255,255,255,0.72)" }}>GROOVE COMPARISON</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{collapsed ? "▼" : "▲"}</span>
      </button>
      {!collapsed && (
        <div style={{ padding: "16px 18px", display: "grid", gap: 14 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.68)", lineHeight: 1.5, background: "rgba(90,163,232,0.07)", border: "1px solid rgba(90,163,232,0.22)", borderRadius: 8, padding: "10px 12px" }}>
            Vista comparativa unica: selecciona uno o varios stems para superponer eventos de groove y sus desviaciones. Las etiquetas de confianza evitan vender ruido como analisis real.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { label: "BPM", value: bpm, min: 60, max: 200, step: 1, set: setBpm, fmt: (value) => value },
              { label: "Subdivision", value: subdivision, min: 8, max: 32, step: 8, set: setSubdivision, fmt: (value) => value },
              { label: "Threshold", value: threshold, min: 0.02, max: 0.5, step: 0.01, set: setThreshold, fmt: (value) => value.toFixed(2) },
            ].map(({ label, value, min, max, step, set, fmt }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 8 }}>
                  <span>{label}</span>
                  <span style={{ color: "#fff", fontFamily: "'Space Mono', monospace" }}>{fmt(value)}</span>
                </div>
                <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => set(label === "Threshold" ? parseFloat(event.target.value) : parseInt(event.target.value, 10))} style={{ width: "100%", accentColor: "#5aa3e8", height: "clamp(8px, 0.9vw, 12px)", cursor: "pointer" }} />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selectedSeries.map((stem) => (
              <label key={stem.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 999, border: `1px solid ${stem.id === activeStemId ? stem.color : `${stem.color}55`}`, background: stem.id === activeStemId ? `${stem.color}22` : `${stem.color}14`, color: "rgba(255,255,255,0.82)", fontSize: 11 }}>
                <input type="checkbox" checked={!!selectedStems[stem.id]} onChange={() => setSelectedStems((prev) => ({ ...prev, [stem.id]: !prev[stem.id] }))} />
                <input type="radio" name="active-groove-stem" checked={stem.id === activeStemId} onChange={() => setActiveStemId(stem.id)} disabled={!stem.selected || !stem.stats?.hasUsefulGroove} />
                <span style={{ color: stem.color, fontFamily: "'Space Mono', monospace" }}>{stem.label}</span>
                <span style={{ color: stem.confidence === "alta" ? "#78d870" : stem.confidence === "media" ? "#e8c547" : "rgba(255,255,255,0.45)" }}>
                  {stem.confidence}
                </span>
              </label>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {selectedSeries.filter((stem) => stem.selected).map((stem) => (
              <div key={`stats-${stem.id}`} style={{ background: "rgba(255,255,255,0.03)", border: `0.5px solid ${stem.color}44`, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: stem.color, marginBottom: 6 }}>{stem.label}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)" }}>onsets {stem.stats?.onsets?.length ?? 0} · mapped {stem.stats?.mappedCount ?? 0}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)" }}>bpm {stem.stats?.activeBpm ? Math.round(stem.stats.activeBpm) : "?"} · var {stem.stats?.deviationStd?.toFixed(1) ?? "0.0"} ms</div>
              </div>
            ))}
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: 1, marginBottom: 8 }}>ONSETS SUPERPUESTOS</div>
            <canvas ref={comparisonCanvasRef} style={{ width: "100%", height: 180, display: "block" }} />
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: 1, marginBottom: 8 }}>DESVIACIONES DE GROOVE</div>
            <canvas ref={deviationCanvasRef} style={{ width: "100%", height: 220, display: "block" }} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.62)", fontSize: 11 }}>
              <span style={{ fontFamily: "'Space Mono', monospace" }}>EXPORT STEM</span>
              <span style={{ color: activeStem?.color || "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace" }}>{activeStem?.label || "NONE"}</span>
            </div>
            <button
              type="button"
              onClick={() => activeStem && grooveExportJSON(activeStem.map, activeStem.stats.activeBpm || bpm, subdivision)}
              disabled={!activeStem}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: activeStem ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.32)",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: 12,
                cursor: activeStem ? "pointer" : "not-allowed",
                fontFamily: "'Space Mono', monospace",
                letterSpacing: 0.5,
              }}
            >
              ↓ JSON stem activo
            </button>
            <button
              type="button"
              onClick={() => activeStem && grooveExportCSV(activeStem.map)}
              disabled={!activeStem}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: activeStem ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.32)",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: 12,
                cursor: activeStem ? "pointer" : "not-allowed",
                fontFamily: "'Space Mono', monospace",
                letterSpacing: 0.5,
              }}
            >
              ↓ CSV stem activo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PatternRow({
  label,
  color,
  steps,
  playheadStep = -1,
  isPlaying = false,
  muted = false,
  effectivelyMuted = false,
  solo = false,
  onToggleMute,
  onToggleSolo,
  level = 85,
  onLevelChange,
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "128px 1fr", gap: 12, alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: 10,
            letterSpacing: 1.5,
            color: effectivelyMuted ? "rgba(255,255,255,0.4)" : color,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onToggleMute}
            style={{
              border: `1px solid ${muted ? "rgba(232,84,71,0.7)" : "rgba(255,255,255,0.18)"}`,
              background: muted ? "rgba(232,84,71,0.12)" : "transparent",
              color: muted ? "#ffb4a8" : "rgba(255,255,255,0.62)",
              borderRadius: 999,
              padding: "3px 8px",
              fontSize: 9,
              cursor: solo ? "not-allowed" : "pointer",
              fontFamily: "'Space Mono', monospace",
              opacity: solo ? 0.45 : 1,
            }}
            disabled={solo}
            title={solo ? "Quita SOLO antes de mutear esta pista" : "Mutear pista en el secuenciador"}
          >
            M
          </button>
          <button
            type="button"
            onClick={onToggleSolo}
            style={{
              border: `1px solid ${solo ? color : "rgba(255,255,255,0.18)"}`,
              background: solo ? `${color}22` : "transparent",
              color: solo ? color : "rgba(255,255,255,0.62)",
              borderRadius: 999,
              padding: "3px 8px",
              fontSize: 9,
              cursor: "pointer",
              fontFamily: "'Space Mono', monospace",
            }}
          >
            S
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "'Space Mono', monospace" }}>VOL</span>
          <input
            type="range"
            min={0}
            max={100}
            value={level}
            onChange={(event) => onLevelChange?.(Number(event.target.value))}
            style={{ flex: 1, accentColor: color, height: "clamp(8px, 0.9vw, 12px)", cursor: "pointer" }}
          />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 4 }}>
        {steps.map((value, index) => (
          <div
            key={`${label}-${index}`}
            title={`Step ${index + 1} · intensity ${(value * 100).toFixed(0)}%`}
            style={{
              height: 18,
              borderRadius: 4,
              border: `1px solid ${
                isPlaying && playheadStep === index
                  ? "rgba(255,255,255,0.95)"
                  : value >= 0.08
                    ? `${color}88`
                    : "rgba(255,255,255,0.12)"
              }`,
              background: value >= 0.08 ? `${color}${effectivelyMuted ? "22" : "55"}` : "rgba(255,255,255,0.03)",
              boxShadow:
                isPlaying && playheadStep === index
                  ? `0 0 0 1px rgba(255,255,255,0.5), 0 0 10px ${color}44 inset`
                  : value >= 0.08
                    ? `0 0 8px ${color}33 inset`
                    : "none",
              opacity: effectivelyMuted ? 0.45 : 1,
              transform: `scaleY(${0.45 + value * 0.55})`,
              transformOrigin: "center bottom",
              position: "relative",
            }}
          >
            {value >= 0.12 && (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 8,
                  color: "rgba(255,255,255,0.82)",
                  fontFamily: "'Space Mono', monospace",
                  pointerEvents: "none",
                  mixBlendMode: "screen",
                }}
              >
                {Math.round(value * 9)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [file, setFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [playing, setPlaying] = useState(null);
  const [error, setError] = useState("");
  const [stems, setStems] = useState({});
  const [patterns, setPatterns] = useState({});
  const [patternStatus, setPatternStatus] = useState("idle");
  const [patternBpm, setPatternBpm] = useState(null);
  const [patternError, setPatternError] = useState("");
  const [patternMode, setPatternMode] = useState("extract");
  const [generationSeed, setGenerationSeed] = useState(1);
  const [creativeToolsVisible, setCreativeToolsVisible] = useState(false);
  const [sequencerPlaying, setSequencerPlaying] = useState(false);
  const [playheadStep, setPlayheadStep] = useState(-1);
  const [patternBars, setPatternBars] = useState(2);
  const [separateMode, setSeparateMode] = useState("fast");
  const [volumes, setVolumes] = useState({ vocals: 85, drums: 85, bass: 85, other: 85 });
  const [sequencerMute, setSequencerMute] = useState({ original: false, drums: false, bass: false, vocals: false, other: false });
  const [sequencerSolo, setSequencerSolo] = useState({ original: false, drums: false, bass: false, vocals: false, other: false });
  const [sequencerLevels, setSequencerLevels] = useState({ original: 82, drums: 85, bass: 72, vocals: 62, other: 66 });
  const [editorDuration, setEditorDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [fadeInMs, setFadeInMs] = useState(0);
  const [fadeOutMs, setFadeOutMs] = useState(0);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const [editorDragMode, setEditorDragMode] = useState(null);
  const [analysisFile, setAnalysisFile] = useState(null);

  const audioRef = useRef(null);
  const currentAudioSourceRef = useRef({ id: null, url: "" });
  const playingRef = useRef(null);
  const trimStartRef = useRef(0);
  const fileRef = useRef(null);
  const waveformCanvasRef = useRef(null);
  const editorDragRef = useRef(null);
  const sequencerTimerRef = useRef(null);
  const sequencerAudioCtxRef = useRef(null);
  const sequencerSourcesRef = useRef({});
  const displayedPatternsRef = useRef({});
  const sequencerMuteRef = useRef({ original: false, drums: false, bass: false, vocals: false, other: false });
  const sequencerSoloRef = useRef({ original: false, drums: false, bass: false, vocals: false, other: false });
  const sequencerLevelsRef = useRef({ original: 82, drums: 85, bass: 72, vocals: 62, other: 66 });
  const hasSequencerSoloRef = useRef(false);

  const accentColor = "#e8c547";
  const ready = status === "done";
  const processing = status === "processing";
  const analyzingPatterns = patternStatus === "processing";

  const modeLabel =
    separateMode === "fast"
      ? "FAST"
      : separateMode === "balanced"
        ? "BALANCED"
        : "QUALITY";

  const engineLabel = "BROWSER";

  const baseName = useMemo(() => {
    if (!file) {
      return "track";
    }
    return file.name.replace(/\.[^.]+$/, "");
  }, [file]);

  const generatedPatterns = useMemo(() => generatePatternSet(patterns, generationSeed), [patterns, generationSeed]);
  const displayedPatterns = patternMode === "generate" ? generatedPatterns : patterns;
  const hasSequencerSolo = useMemo(() => Object.values(sequencerSolo).some(Boolean), [sequencerSolo]);
  const editedDuration = useMemo(() => Math.max(0, (trimEnd || editorDuration) - trimStart), [editorDuration, trimEnd, trimStart]);
  const previewOffset = useMemo(() => {
    if (!Number.isFinite(previewPosition)) {
      return 0;
    }
    return clamp(previewPosition - trimStart, 0, editedDuration || 0);
  }, [editedDuration, previewPosition, trimStart]);
  const previewProgress = useMemo(() => {
    if (!editedDuration) {
      return 0;
    }
    return (previewOffset / editedDuration) * 100;
  }, [editedDuration, previewOffset]);
  const isPreviewPlaying = playing === "original-preview";
  const sequencerActiveVoices = useMemo(() => {
    const voices = ["original", "drums", "bass", "vocals", "other"];
    return voices.filter((voiceId) => !sequencerMute[voiceId] && (!hasSequencerSolo || sequencerSolo[voiceId]));
  }, [hasSequencerSolo, sequencerMute, sequencerSolo]);
  const sequencerMixStatus = useMemo(() => {
    if (!sequencerActiveVoices.length) {
      return { text: "Todas las pistas estan muteadas para el secuenciador.", tone: "warning" };
    }

    if (hasSequencerSolo) {
      return {
        text: `Solo activo en: ${sequencerActiveVoices.map((voice) => voice.toUpperCase()).join(", ")}`,
        tone: "accent",
      };
    }

    if (sequencerActiveVoices.length === 5) {
      return { text: "Todas las pistas del secuenciador estan habilitadas.", tone: "neutral" };
    }

    return {
      text: `Pistas activas: ${sequencerActiveVoices.map((voice) => voice.toUpperCase()).join(", ")}`,
      tone: "neutral",
    };
  }, [hasSequencerSolo, sequencerActiveVoices]);

  useEffect(() => {
    displayedPatternsRef.current = displayedPatterns;
  }, [displayedPatterns]);

  useEffect(() => {
    sequencerMuteRef.current = sequencerMute;
  }, [sequencerMute]);

  useEffect(() => {
    sequencerSoloRef.current = sequencerSolo;
  }, [sequencerSolo]);

  useEffect(() => {
    sequencerLevelsRef.current = sequencerLevels;
  }, [sequencerLevels]);

  useEffect(() => {
    hasSequencerSoloRef.current = hasSequencerSolo;
  }, [hasSequencerSolo]);

  const stopSequencer = useCallback(() => {
    if (sequencerTimerRef.current) {
      clearInterval(sequencerTimerRef.current);
      sequencerTimerRef.current = null;
    }
    setSequencerPlaying(false);
    setPlayheadStep(-1);
  }, []);

  const triggerSequencerSlice = useCallback((audioContext, voiceId, step, time, intensity = 1) => {
    const sourceInfo = sequencerSourcesRef.current[voiceId];
    if (!sourceInfo?.buffer || !sourceInfo.stepDuration) {
      return;
    }

    const offset = step * sourceInfo.stepDuration;
    const maxDuration = Math.max(0, sourceInfo.buffer.duration - offset);
    const intensityScale = Math.max(0.08, Math.min(1, intensity));
    const durationShape =
      voiceId === "drums" ? 0.62 :
      voiceId === "bass" ? 0.92 :
      voiceId === "vocals" ? 1.35 :
      voiceId === "other" ? 1.15 :
      0.88;
    const duration = Math.min(sourceInfo.stepDuration * durationShape * (0.55 + intensityScale * 0.7), maxDuration);
    if (duration < 0.02) {
      return;
    }

    const source = audioContext.createBufferSource();
    source.buffer = sourceInfo.buffer;

    const gain = audioContext.createGain();
    const baseGain =
      voiceId === "drums" ? 0.82 :
      voiceId === "bass" ? 0.66 :
      voiceId === "vocals" ? 0.48 :
      voiceId === "other" ? 0.54 :
      0.42;
    const levelScale = Math.max(0, Math.min(1, (sequencerLevelsRef.current[voiceId] ?? 85) / 100));
    const targetGain = Math.max(0.0001, baseGain * levelScale * (0.4 + intensityScale * 0.75));

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(targetGain, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start(time, offset, duration);
  }, []);

  const toggleSequencer = useCallback(async () => {
    if (sequencerPlaying) {
      stopSequencer();
      return;
    }

    if (patternStatus !== "done") {
      return;
    }

    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPlaying(null);
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setPatternError("Tu navegador no soporta Web Audio para reproducir el secuenciador.");
      return;
    }

    if (!sequencerAudioCtxRef.current || sequencerAudioCtxRef.current.state === "closed") {
      sequencerAudioCtxRef.current = new AudioContextClass();
    }

    const audioContext = sequencerAudioCtxRef.current;
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const stepMs = (60_000 / Math.max(1, patternBpm || 120)) / 4;
    let step = 0;
    setPlayheadStep(0);
    setSequencerPlaying(true);

    const keys = ["original", "drums", "bass", "vocals", "other"];
    const stepCount = Math.max(...keys.map((key) => displayedPatternsRef.current[key]?.length || 0), 16);
    const tick = () => {
      setPlayheadStep(step);

      const activePatterns = displayedPatternsRef.current;
      const activeMute = sequencerMuteRef.current;
      const activeSolo = sequencerSoloRef.current;
      const soloEnabled = hasSequencerSoloRef.current;

      for (const key of keys) {
        const row = activePatterns[key];
        const stepValue = row?.[step] ?? 0;
        const allowed = !activeMute[key] && (!soloEnabled || activeSolo[key]);
        if (allowed && stepValue >= 0.08) {
          triggerSequencerSlice(audioContext, key, step, audioContext.currentTime + 0.005, stepValue);
        }
      }

      step = (step + 1) % stepCount;
    };

    tick();
    sequencerTimerRef.current = setInterval(tick, stepMs);
  }, [patternBpm, patternStatus, sequencerPlaying, stopSequencer, triggerSequencerSlice]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    trimStartRef.current = trimStart;
  }, [trimStart]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const onEnded = () => setPlaying(null);
    const onError = () => {
      const hasCurrentSrc = Boolean(audio.currentSrc || audio.getAttribute("src"));
      const hasTrackedSrc = Boolean(currentAudioSourceRef.current?.url);
      if (!hasCurrentSrc && !hasTrackedSrc) {
        return;
      }

      const mediaError = audio.error;
      const details = mediaError
        ? ` (code ${mediaError.code}${mediaError.message ? `: ${mediaError.message}` : ""})`
        : "";
      setError(`No se pudo cargar/reproducir el audio${details}.`);
      setPlaying(null);
    };
    const onPause = () => {
      if (playingRef.current !== "original-preview") {
        setPreviewPosition(null);
      }
    };
    const onTimeUpdate = () => {
      if (playingRef.current === "original-preview") {
        setPreviewPosition(audio.currentTime + trimStartRef.current);
      }
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      audio.pause();
      audio.src = "";
      currentAudioSourceRef.current = { id: null, url: "" };
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

  useEffect(() => {
    if (!playing || !audioRef.current) {
      return;
    }
    if (playing === "original") {
      audioRef.current.volume = 1;
      return;
    }
    const volume = volumes[playing] ?? 85;
    audioRef.current.volume = volume / 100;
  }, [playing, volumes]);

  useEffect(() => {
    return () => {
      stopSequencer();
      if (sequencerAudioCtxRef.current && sequencerAudioCtxRef.current.state !== "closed") {
        sequencerAudioCtxRef.current.close();
      }
    };
  }, [stopSequencer]);

  useEffect(() => {
    stopSequencer();
  }, [patternMode, generationSeed, patternStatus, stopSequencer]);

  useEffect(() => {
    if (!analysisFile || !ready || !Object.keys(stems).length) {
      return;
    }

    createPatterns(analysisFile, stems);
  }, [analysisFile, patternBars, ready, stems]);

  useEffect(() => {
    if (!file || !ready || !Object.keys(stems).length) {
      return;
    }
  }, [file, ready, stems]);

  useEffect(
    () => () => {
      if (originalUrl) {
        URL.revokeObjectURL(originalUrl);
      }
    },
    [originalUrl],
  );

  const sourceBufferRef = useRef(null);
  const waveformMonoRef = useRef(null);

  useEffect(() => {
    drawEditorWaveform(
      waveformCanvasRef.current,
      waveformMonoRef.current,
      trimStart,
      trimEnd || editorDuration,
      editorDuration,
      previewPosition,
    );
  }, [editorDuration, previewPosition, trimEnd, trimStart]);

  const updateTrimFromPointer = useCallback(
    (clientX) => {
      const canvas = waveformCanvasRef.current;
      const drag = editorDragRef.current;
      if (!canvas || !drag || !editorDuration) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const time = ratio * editorDuration;
      const minGap = 0.05;

      if (drag.mode === "start") {
        setTrimStart(clamp(time, 0, Math.max(0, trimEnd - minGap)));
        return;
      }

      if (drag.mode === "end") {
        setTrimEnd(clamp(time, Math.min(editorDuration, trimStart + minGap), editorDuration));
        return;
      }

      if (drag.mode === "move") {
        const nextStart = clamp(time - drag.pointerOffset, 0, Math.max(0, editorDuration - drag.selectionLength));
        const nextEnd = Math.min(editorDuration, nextStart + drag.selectionLength);
        setTrimStart(nextStart);
        setTrimEnd(nextEnd);
      }
    },
    [editorDuration, trimEnd, trimStart],
  );

  useEffect(() => {
    if (!editorDragMode) {
      return undefined;
    }

    const handlePointerMove = (event) => {
      updateTrimFromPointer(event.clientX);
    };

    const handlePointerUp = () => {
      editorDragRef.current = null;
      setEditorDragMode(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [editorDragMode, updateTrimFromPointer]);

  const beginWaveformDrag = useCallback(
    (event) => {
      if (editorLoading || !editorDuration || !waveformCanvasRef.current) {
        return;
      }

      const rect = waveformCanvasRef.current.getBoundingClientRect();
      const pointerX = clamp(event.clientX - rect.left, 0, rect.width);
      const startX = (trimStart / editorDuration) * rect.width;
      const endX = ((trimEnd || editorDuration) / editorDuration) * rect.width;
      const handleZone = 16;

      let mode = null;
      if (Math.abs(pointerX - startX) <= handleZone) {
        mode = "start";
      } else if (Math.abs(pointerX - endX) <= handleZone) {
        mode = "end";
      } else if (pointerX > startX && pointerX < endX) {
        mode = "move";
      }

      if (!mode) {
        return;
      }

      event.preventDefault();
      const pointerTime = (pointerX / Math.max(1, rect.width)) * editorDuration;
      editorDragRef.current = {
        mode,
        pointerOffset: pointerTime - trimStart,
        selectionLength: Math.max(0.05, (trimEnd || editorDuration) - trimStart),
      };
      setEditorDragMode(mode);
      updateTrimFromPointer(event.clientX);
    },
    [editorDuration, editorLoading, trimEnd, trimStart, updateTrimFromPointer],
  );

  const loadEditorBuffer = useCallback(async (incoming) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Tu navegador no soporta Web Audio para previsualizar el archivo.");
    }

    const context = new AudioContextClass();
    try {
      const arrayBuffer = await incoming.arrayBuffer();
      const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      sourceBufferRef.current = decoded;
      waveformMonoRef.current = mixToMono(decoded);
      setEditorError("");
      setEditorDuration(decoded.duration);
      setTrimStart(0);
      setTrimEnd(decoded.duration);
      setFadeInMs(0);
      setFadeOutMs(0);
      setAnalysisFile(incoming);
      return true;
    } finally {
      await context.close();
    }
  }, []);

  const buildEditedFile = useCallback(async () => {
    if (!file || !sourceBufferRef.current) {
      return file;
    }

    const safeEnd = Math.max(trimStart + 0.05, trimEnd || editorDuration || trimStart + 0.05);
    const editedBuffer = renderEditedBuffer(
      sourceBufferRef.current,
      trimStart,
      safeEnd,
      fadeInMs / 1000,
      fadeOutMs / 1000,
    );
    const blob = audioBufferToWavBlob(editedBuffer);
    return new File([blob], `${baseName || "track"}-edit.wav`, { type: "audio/wav" });
  }, [baseName, editorDuration, fadeInMs, fadeOutMs, file, trimEnd, trimStart]);

  const playSource = async (sourceId, sourceUrl, volume = 1) => {
    const player = audioRef.current;
    if (!player || !sourceUrl || typeof sourceUrl !== "string" || !sourceUrl.trim()) {
      return;
    }

    const normalizedUrl = sourceUrl.trim();

    if (sequencerPlaying) {
      stopSequencer();
    }

    if (playing === sourceId) {
      if (!player.paused) {
        player.pause();
        setPlaying(null);
        return;
      }

      try {
        if (!player.getAttribute("src") || !player.currentSrc) {
          player.src = normalizedUrl;
          player.load();
          currentAudioSourceRef.current = { id: sourceId, url: normalizedUrl };
        }
        player.volume = volume;
        player.muted = false;
        await player.play();
        setPlaying(sourceId);
      } catch (error) {
        const details = error instanceof Error ? `: ${error.message}` : "";
        setError(`No se pudo reanudar la reproduccion${details}`);
      }
      return;
    }

    player.pause();
    const sourceChanged = currentAudioSourceRef.current.url !== normalizedUrl;
    if (sourceChanged) {
      player.src = normalizedUrl;
      player.load();
      currentAudioSourceRef.current = { id: sourceId, url: normalizedUrl };
    } else if (!player.getAttribute("src") || !player.currentSrc) {
      player.src = normalizedUrl;
      player.load();
      currentAudioSourceRef.current = { id: sourceId, url: normalizedUrl };
    }
    player.currentTime = 0;
    player.volume = volume;
    player.muted = false;

    try {
      await player.play();
      setPlaying(sourceId);
    } catch (error) {
      const details = error instanceof Error ? `: ${error.message}` : "";
      setError(`No se pudo iniciar la reproduccion${details}`);
      setPlaying(null);
    }
  };

  const createPatterns = async (sourceFile, stemMap) => {
    if (!sourceFile) {
      return;
    }

    setPatternStatus("processing");
    setPatternError("");

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setPatternStatus("error");
      setPatternError("Tu navegador no soporta Web Audio para analizar patrones.");
      return;
    }

    const audioContext = new AudioContextClass();

    try {
      const decode = async (arrayBuffer) => {
        const copy = arrayBuffer.slice(0);
        return audioContext.decodeAudioData(copy);
      };

      const originalBuffer = await decode(await sourceFile.arrayBuffer());
      const originalMono = mixToMono(originalBuffer);
      const bpm = estimateBpm(originalMono, originalBuffer.sampleRate);
      const totalSteps = 16 * patternBars;
      const originalWindow = getPatternWindow(originalBuffer.duration, bpm, totalSteps, patternBars);

      const nextPatterns = {
        original: buildStepPattern(originalMono, originalBuffer.sampleRate, bpm, totalSteps, patternBars),
      };
      const sourceMap = {
        original: {
          buffer: originalBuffer,
          stepDuration: originalWindow.stepDuration,
        },
      };

      for (const stem of STEMS) {
        const url = stemMap[stem.id];
        if (!url) {
          continue;
        }

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`No se pudo analizar ${stem.label}.`);
        }
        const stemBuffer = await decode(await response.arrayBuffer());
        const stemMono = mixToMono(stemBuffer);
        nextPatterns[stem.id] = buildStepPattern(stemMono, stemBuffer.sampleRate, bpm, totalSteps, patternBars);
        sourceMap[stem.id] = {
          buffer: stemBuffer,
          stepDuration: getPatternWindow(stemBuffer.duration, bpm, totalSteps, patternBars).stepDuration,
        };
      }

      setPatternBpm(Math.round(bpm));
      setPatterns(nextPatterns);
      sequencerSourcesRef.current = sourceMap;
      setPatternStatus("done");
    } catch {
      setPatternStatus("error");
      setPatternError("No se pudo generar el patron del sequencer.");
      sequencerSourcesRef.current = {};
    } finally {
      await audioContext.close();
    }
  };

  const handleFile = (incoming) => {
    if (!incoming) {
      return;
    }
    if (!incoming || !ACCEPT_AUDIO.test(incoming.name)) {
      setError("Formato no soportado. Usa WAV, MP3, FLAC o AIFF.");
      return;
    }

    if (originalUrl) {
      URL.revokeObjectURL(originalUrl);
    }

    const localUrl = URL.createObjectURL(incoming);

    setError("");
    setEditorError("");
    setFile(incoming);
    setAnalysisFile(incoming);
    setOriginalUrl(localUrl);
    setEditorLoading(true);
    setPreviewPosition(null);
    setStatus("idle");
    setProgress(0);
    setCurrentStep("");
    setStems({});
    setPatterns({});
    setPatternBpm(null);
    setPatternStatus("idle");
    setPatternError("");
    setPatternMode("extract");
    setGenerationSeed(1);
    setPatternBars(2);
    setCreativeToolsVisible(false);
    setSequencerMute({ original: false, drums: false, bass: false, vocals: false, other: false });
    setSequencerSolo({ original: false, drums: false, bass: false, vocals: false, other: false });
    setSequencerLevels({ original: 82, drums: 85, bass: 72, vocals: 62, other: 66 });
    sequencerSourcesRef.current = {};
    stopSequencer();
    setPlaying(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      currentAudioSourceRef.current = { id: null, url: "" };
    }

    loadEditorBuffer(incoming)
      .catch((loadError) => {
        sourceBufferRef.current = null;
        waveformMonoRef.current = null;
        setEditorDuration(0);
        setTrimStart(0);
        setTrimEnd(0);
        setFadeInMs(0);
        setFadeOutMs(0);
        setEditorError(
          loadError instanceof Error
            ? `Editor no disponible para este WAV: ${loadError.message}`
            : "Editor no disponible para este archivo, pero el track sigue cargado.",
        );
      })
      .finally(() => {
        setEditorLoading(false);
      });
  };

  const onDrop = useCallback((event) => {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files[0]);
  }, []);

  const clearFile = () => {
    if (originalUrl) {
      URL.revokeObjectURL(originalUrl);
    }

    setFile(null);
    setAnalysisFile(null);
    setOriginalUrl("");
    setEditorError("");
    setEditorDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setFadeInMs(0);
    setFadeOutMs(0);
    setPreviewPosition(null);
    sourceBufferRef.current = null;
    waveformMonoRef.current = null;
    setStatus("idle");
    setProgress(0);
    setCurrentStep("");
    setError("");
    setStems({});
    setPatterns({});
    setPatternBpm(null);
    setPatternStatus("idle");
    setPatternError("");
    setPatternMode("extract");
    setGenerationSeed(1);
    setPatternBars(2);
    setCreativeToolsVisible(false);
    setSequencerMute({ original: false, drums: false, bass: false, vocals: false, other: false });
    setSequencerSolo({ original: false, drums: false, bass: false, vocals: false, other: false });
    setSequencerLevels({ original: 82, drums: 85, bass: 72, vocals: 62, other: 66 });
    sequencerSourcesRef.current = {};
    stopSequencer();
    setPlaying(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      currentAudioSourceRef.current = { id: null, url: "" };
    }
  };

  const processTrack = async () => {
    if (!file) {
      return;
    }

    setError("");
    setPatternError("");
    setPatternStatus("idle");
    setPatterns({});
    setPatternBpm(null);
    setPatternMode("extract");
    setGenerationSeed(1);
    setPatternBars(2);
    setCreativeToolsVisible(false);
    setSequencerMute({ original: false, drums: false, bass: false, vocals: false, other: false });
    setSequencerSolo({ original: false, drums: false, bass: false, vocals: false, other: false });
    setSequencerLevels({ original: 82, drums: 85, bass: 72, vocals: 62, other: 66 });
    sequencerSourcesRef.current = {};
    stopSequencer();
    setStatus("processing");
    setProgress(3);
    setCurrentStep(getStepLabel(3));

    let ghostProgress = 3;
    let ticks = 0;
    const ticker = setInterval(() => {
      ticks += 1;
      const cap = ticks < 30 ? 96 : 99;
      const step = ghostProgress < 60 ? 4 : ghostProgress < 88 ? 2 : 0.6;
      ghostProgress = Math.min(cap, ghostProgress + step);
      setProgress(ghostProgress);
      setCurrentStep(getStepLabel(ghostProgress));
    }, 380);

    try {
      const sourceFile = await buildEditedFile();
      setAnalysisFile(sourceFile);

      const nextStems = await separateTrackViaModal(sourceFile, {
        onProgress: ({ progress: nextProgress, label }) => {
          if (Number.isFinite(nextProgress)) {
            setProgress(Math.max(3, Math.min(96, Math.round(nextProgress))));
          }
          if (label) {
            setCurrentStep(label);
          }
        },
      });

      setStems(nextStems || {});
      setProgress(100);
      setCurrentStep("Stems ready");
      setStatus("done");
      await createPatterns(sourceFile, nextStems || {});
    } catch (processingError) {
      setStatus("error");
      setPlaying(null);
      setStems({});
      setError(processingError instanceof Error ? processingError.message : "Error desconocido");
    } finally {
      clearInterval(ticker);
    }
  };

  const playStem = async (stemId) => {
    const url = stems[stemId];
    if (!url) {
      return;
    }

    await playSource(stemId, url, (volumes[stemId] ?? 85) / 100);
  };

  const toggleOriginalPlayback = async () => {
    if (!originalUrl) {
      return;
    }
    await playSource("original", originalUrl, 1);
  };

  const previewEditedMix = useCallback(async () => {
    if (!file) {
      return;
    }

    setPreviewBusy(true);
    setPreviewPosition(trimStart);
    try {
      const previewFile = await buildEditedFile();
      const previewUrl = URL.createObjectURL(previewFile);
      await playSource("original-preview", previewUrl, 1);
      const player = audioRef.current;
      if (player) {
        const revoke = () => {
          setPreviewPosition(null);
          URL.revokeObjectURL(previewUrl);
          player.removeEventListener("ended", revoke);
        };
        player.addEventListener("ended", revoke);
      }
    } catch {
      setPreviewPosition(null);
      setError("No se pudo generar la preview editada.");
    } finally {
      setPreviewBusy(false);
    }
  }, [buildEditedFile, file]);

  const restartPreview = useCallback(async () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlaying(null);
    setPreviewPosition(trimStart);
    await previewEditedMix();
  }, [previewEditedMix, trimStart]);

  const pauseStem = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPreviewPosition(null);
    setPlaying(null);
  };

  const setStemVolume = (stemId, value) => {
    setVolumes((prev) => ({ ...prev, [stemId]: value }));
  };

  const regeneratePattern = () => {
    setGenerationSeed((seed) => seed + 1);
    setPatternMode("generate");
  };

  const toggleSequencerMute = (voiceId) => {
    if (sequencerSolo[voiceId]) {
      return;
    }
    setSequencerMute((prev) => ({ ...prev, [voiceId]: !prev[voiceId] }));
  };

  const toggleSequencerSolo = (voiceId) => {
    setSequencerSolo((prev) => {
      if (prev[voiceId]) {
        return { original: false, drums: false, bass: false, vocals: false, other: false };
      }

      return { original: false, drums: false, bass: false, vocals: false, other: false, [voiceId]: true };
    });
    setSequencerMute((prev) => ({ ...prev, [voiceId]: false }));
  };

  const setSequencerLevel = (voiceId, value) => {
    setSequencerLevels((prev) => ({ ...prev, [voiceId]: value }));
  };

  const toggleCreativeTools = () => {
    setCreativeToolsVisible((prev) => {
      if (prev && patternMode === "generate") {
        setPatternMode("extract");
      }
      return !prev;
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 20% -10%, rgba(232,197,71,0.09), transparent 45%), radial-gradient(circle at 90% 90%, rgba(71,184,232,0.08), transparent 40%), #08090b",
        color: "#ffffff",
        fontFamily: "'Manrope', sans-serif",
        padding: "36px 18px 48px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

        input[type=range] {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          border-radius: 999px;
          height: clamp(8px, 0.9vw, 12px);
        }

        input[type=range]::-webkit-slider-runnable-track {
          background: linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.1));
          border-radius: 999px;
          height: clamp(8px, 0.9vw, 12px);
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.5), inset 0 -1px 1px rgba(255,255,255,0.07);
        }

        input[type=range]::-moz-range-track {
          background: linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.1));
          border-radius: 999px;
          height: clamp(8px, 0.9vw, 12px);
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.5), inset 0 -1px 1px rgba(255,255,255,0.07);
        }

        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: clamp(18px, 1.3vw, 24px);
          height: clamp(18px, 1.3vw, 24px);
          border-radius: 50%;
          cursor: pointer;
          border: none;
          margin-top: calc((clamp(8px, 0.9vw, 12px) - clamp(18px, 1.3vw, 24px)) / 2);
          background: radial-gradient(circle at 35% 30%, #f1f4f8, #bcc4cf 58%, #929ca9 100%);
          box-shadow: 0 0 0 2px rgba(8,9,11,0.7), 0 2px 5px rgba(0,0,0,0.45);
          transition: transform 140ms ease, box-shadow 140ms ease;
        }

        input[type=range]::-moz-range-thumb {
          width: clamp(18px, 1.3vw, 24px);
          height: clamp(18px, 1.3vw, 24px);
          border-radius: 50%;
          cursor: pointer;
          border: none;
          background: radial-gradient(circle at 35% 30%, #f1f4f8, #bcc4cf 58%, #929ca9 100%);
          box-shadow: 0 0 0 2px rgba(8,9,11,0.7), 0 2px 5px rgba(0,0,0,0.45);
          transition: transform 140ms ease, box-shadow 140ms ease;
        }

        input[type=range]:hover::-webkit-slider-thumb,
        input[type=range]:focus-visible::-webkit-slider-thumb,
        input[type=range]:hover::-moz-range-thumb,
        input[type=range]:focus-visible::-moz-range-thumb {
          transform: scale(1.04);
          box-shadow: 0 0 0 2px rgba(8,9,11,0.7), 0 0 0 5px rgba(232,197,71,0.22), 0 4px 8px rgba(0,0,0,0.5);
        }

        .stems-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 18px;
        }

        @media (max-width: 760px) {
          .stems-grid {
            grid-template-columns: 1fr;
          }
        }

        @keyframes wavePulse {
          from { transform: scaleY(0.82); }
          to { transform: scaleY(1.08); }
        }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: accentColor,
                boxShadow: `0 0 14px ${accentColor}`,
              }}
            />
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 10,
                letterSpacing: 3.2,
                color: "rgba(255,255,255,0.42)",
                textTransform: "uppercase",
              }}
            >
              Studio Stem Rack / Next.js
            </span>
          </div>

          <h1
            style={{
              margin: 0,
              fontFamily: "'Space Mono', monospace",
              fontSize: "clamp(26px, 4vw, 40px)",
              lineHeight: 1.05,
              letterSpacing: -1,
            }}
          >
            FOUR-STEM
            <br />
            <span style={{ color: accentColor }}>SEPARATOR</span>
          </h1>

          <p style={{ marginTop: 12, maxWidth: 640, color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.6 }}>
            Upload a full mix and split it into vocals, drums, bass and other using a remote Demucs HTDemucs endpoint on Modal.
          </p>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => {
            if (!file) {
              fileRef.current?.click();
            }
          }}
          style={{
            border: `2px dashed ${dragging ? accentColor : file ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 16,
            padding: file ? "20px 24px" : "38px 24px",
            marginBottom: 22,
            cursor: file ? "default" : "pointer",
            transition: "all 0.25s ease",
            background: dragging ? "rgba(232,197,71,0.05)" : "rgba(255,255,255,0.02)",
            display: "flex",
            alignItems: "center",
            justifyContent: file ? "space-between" : "center",
            flexDirection: file ? "row" : "column",
            gap: 16,
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".wav,.mp3,.flac,.aif,.aiff"
            style={{ display: "none" }}
            onChange={(event) => handleFile(event.target.files[0])}
          />

          {!file ? (
            <>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.1)",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "'Space Mono', monospace",
                  color: accentColor,
                }}
              >
                WAV
              </div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "rgba(255,255,255,0.58)" }}>
                DRAG YOUR AUDIO FILE HERE
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>WAV / MP3 / FLAC / AIFF</div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: "rgba(232,197,71,0.12)",
                    border: "1px solid rgba(232,197,71,0.3)",
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "'Space Mono', monospace",
                    color: accentColor,
                    fontSize: 11,
                  }}
                >
                  MIX
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 12,
                      color: "#ffffff",
                      fontWeight: 700,
                      wordBreak: "break-all",
                    }}
                  >
                    {file.name}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleOriginalPlayback();
                  }}
                  style={{
                    background: playing === "original" ? accentColor : "none",
                    border: `1px solid ${playing === "original" ? accentColor : "rgba(255,255,255,0.14)"}`,
                    color: playing === "original" ? "#050505" : "rgba(255,255,255,0.75)",
                    padding: "6px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "'Space Mono', monospace",
                    letterSpacing: 0.3,
                  }}
                >
                  {playing === "original" ? "PAUSE MIX" : "PLAY MIX"}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    previewEditedMix();
                  }}
                  disabled={editorLoading || previewBusy}
                  style={{
                    background: "none",
                    border: `1px solid ${previewBusy ? accentColor : "rgba(255,255,255,0.14)"}`,
                    color: previewBusy ? accentColor : "rgba(255,255,255,0.75)",
                    padding: "6px 12px",
                    borderRadius: 8,
                    cursor: editorLoading ? "wait" : "pointer",
                    fontSize: 11,
                    fontFamily: "'Space Mono', monospace",
                    letterSpacing: 0.3,
                    opacity: editorLoading ? 0.6 : 1,
                  }}
                >
                  {previewBusy ? "RENDERING..." : "PREVIEW EDIT"}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearFile();
                  }}
                  style={{
                    background: "none",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "rgba(255,255,255,0.55)",
                    padding: "6px 14px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "'Space Mono', monospace",
                  }}
                >
                  CLEAR
                </button>
              </div>
            </>
          )}
        </div>

        {error && (
          <div
            style={{
              marginBottom: 18,
              border: "1px solid rgba(232,84,71,0.45)",
              background: "rgba(232,84,71,0.08)",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 12,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            {error}
          </div>
        )}

        {editorError && (
          <div
            style={{
              marginBottom: 18,
              border: "1px solid rgba(232,197,71,0.35)",
              background: "rgba(232,197,71,0.08)",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 12,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            {editorError}
          </div>
        )}

        {file && (
          <div
            style={{
              marginBottom: 24,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              padding: "16px 18px",
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.68)", marginBottom: 6 }}>
                  MIX EDITOR
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
                  {editorError ? "Editor no disponible para este archivo; el procesado sigue funcionando." : "Trim, fade in/out y preview antes de separar stems."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isPreviewPlaying) {
                      pauseStem();
                    } else {
                      previewEditedMix();
                    }
                  }}
                  disabled={editorLoading || previewBusy}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 999,
                    border: `1px solid ${isPreviewPlaying ? accentColor : "rgba(255,255,255,0.14)"}`,
                    background: isPreviewPlaying ? accentColor : "rgba(255,255,255,0.03)",
                    color: isPreviewPlaying ? "#050505" : "rgba(255,255,255,0.82)",
                    cursor: editorLoading || previewBusy ? "wait" : "pointer",
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 12,
                    boxShadow: isPreviewPlaying ? `0 0 18px rgba(232,197,71,0.22)` : "none",
                  }}
                  title={isPreviewPlaying ? "Pausar preview" : "Reproducir preview"}
                >
                  {isPreviewPlaying ? "II" : "▶"}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    restartPreview();
                  }}
                  disabled={editorLoading || previewBusy || !editedDuration}
                  style={{
                    height: 38,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.03)",
                    color: "rgba(255,255,255,0.72)",
                    cursor: editorLoading || previewBusy ? "wait" : "pointer",
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 10,
                    letterSpacing: 1.2,
                    padding: "0 14px",
                  }}
                  title="Volver a empezar la preview"
                >
                  RESTART
                </button>
              </div>
            </div>

            <div
              style={{
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                minHeight: 120,
                opacity: editorError ? 0.45 : 1,
                cursor:
                  editorLoading || editorError
                    ? "default"
                    : editorDragMode === "move"
                      ? "grabbing"
                      : "ew-resize",
              }}
            >
              <canvas
                ref={waveformCanvasRef}
                onPointerDown={beginWaveformDrag}
                style={{ width: "100%", height: 120, display: "block", touchAction: "none" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.46)" }}>
              <span style={{ color: accentColor }}>Arrastra el borde izquierdo o derecho sobre la onda para hacer trim.</span>
              <span>Mueve la zona central para desplazar la selección completa.</span>
            </div>

            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(232,197,71,0.18)",
                background: "linear-gradient(180deg, rgba(232,197,71,0.08), rgba(232,197,71,0.02))",
                padding: "12px 14px",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 1.4, color: accentColor }}>
                  PREVIEW TRANSPORT
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.66)" }}>
                  <span>IN {formatSeconds(trimStart)}</span>
                  <span>OUT {formatSeconds(trimEnd || editorDuration)}</span>
                  <span>LEN {formatSeconds(editedDuration)}</span>
                </div>
              </div>

              <div style={{ position: "relative", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(90deg, rgba(232,197,71,0.18), rgba(232,197,71,0.08))",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${previewProgress}%`,
                    minWidth: isPreviewPlaying || previewProgress > 0 ? 6 : 0,
                    borderRadius: 999,
                    background: "linear-gradient(90deg, #e8c547 0%, #ffd978 100%)",
                    boxShadow: "0 0 14px rgba(232,197,71,0.45)",
                    transition: isPreviewPlaying ? "width 0.08s linear" : "width 0.18s ease",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: `calc(${previewProgress}% - 7px)`,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: "2px solid rgba(8,9,11,0.9)",
                    background: accentColor,
                    boxShadow: "0 0 0 3px rgba(232,197,71,0.16), 0 0 14px rgba(232,197,71,0.45)",
                    transform: "translateY(-50%)",
                    opacity: previewProgress > 0 || isPreviewPlaying ? 1 : 0,
                    transition: "left 0.08s linear, opacity 0.18s ease",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.48)" }}>
                <span>{previewBusy ? "Renderizando preview editada..." : isPreviewPlaying ? `Reproduciendo ${formatSeconds(previewOffset)} / ${formatSeconds(editedDuration)}` : "Preview lista para revisar el tramo editado."}</span>
                <span style={{ color: accentColor, fontFamily: "'Space Mono', monospace" }}>{Math.round(previewProgress)}%</span>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>TRIM IN</div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, editorDuration - 0.05)}
                    step={0.01}
                    value={Math.min(trimStart, Math.max(0, trimEnd - 0.05))}
                    onChange={(event) => setTrimStart(Math.min(Number(event.target.value), Math.max(0, trimEnd - 0.05)))}
                    disabled={editorLoading || !editorDuration}
                  />
                </div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: accentColor }}>
                  {formatSeconds(trimStart)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>TRIM OUT</div>
                  <input
                    type="range"
                    min={Math.min(editorDuration, trimStart + 0.05)}
                    max={editorDuration || 0}
                    step={0.01}
                    value={Math.max(trimEnd || 0, Math.min(editorDuration, trimStart + 0.05))}
                    onChange={(event) => setTrimEnd(Math.max(Number(event.target.value), Math.min(editorDuration, trimStart + 0.05)))}
                    disabled={editorLoading || !editorDuration}
                  />
                </div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: accentColor }}>
                  {formatSeconds(trimEnd || editorDuration)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>FADE IN</div>
                  <input
                    type="range"
                    min={0}
                    max={Math.round(Math.max(0, (trimEnd - trimStart) * 1000))}
                    step={10}
                    value={fadeInMs}
                    onChange={(event) => setFadeInMs(Number(event.target.value))}
                    disabled={editorLoading || !editorDuration}
                  />
                </div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.58)" }}>
                  {fadeInMs} ms
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>FADE OUT</div>
                  <input
                    type="range"
                    min={0}
                    max={Math.round(Math.max(0, (trimEnd - trimStart) * 1000))}
                    step={10}
                    value={fadeOutMs}
                    onChange={(event) => setFadeOutMs(Number(event.target.value))}
                    disabled={editorLoading || !editorDuration}
                  />
                </div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.58)" }}>
                  {fadeOutMs} ms
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
              <span>Duracion original: {formatSeconds(editorDuration)}</span>
              <span>Duracion editada: {formatSeconds(editedDuration)}</span>
            </div>
          </div>
        )}

        {file && !ready && (
          <div style={{ marginBottom: 24 }}>
            {!processing && (
              <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { id: "fast", label: "FAST", hint: "mdx_extra" },
                    { id: "balanced", label: "BAL", hint: "htdemucs" },
                    { id: "quality", label: "HQ", hint: "htdemucs 320k" },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setSeparateMode(mode.id)}
                      style={{
                        border: `1px solid ${separateMode === mode.id ? accentColor : "rgba(255,255,255,0.2)"}`,
                        color: separateMode === mode.id ? accentColor : "rgba(255,255,255,0.7)",
                        background: "transparent",
                        borderRadius: 999,
                        padding: "6px 11px",
                        fontSize: 10,
                        cursor: "pointer",
                        fontFamily: "'Space Mono', monospace",
                        letterSpacing: 1,
                      }}
                      title={mode.hint}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                  Remote mode envia el audio editado al endpoint de Modal, descarga un ZIP con stems y lo carga en los reproductores y el secuenciador.
                </div>
              </div>
            )}

            {!processing ? (
              <button
                type="button"
                onClick={processTrack}
                style={{
                  width: "100%",
                  padding: "15px",
                  background: accentColor,
                  color: "#050505",
                  border: "none",
                  borderRadius: 12,
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 2,
                  cursor: "pointer",
                }}
              >
                PROCESS {engineLabel} ({modeLabel})
              </button>
            ) : (
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: "18px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <ProgressRing progress={progress} color={accentColor} />
                <div style={{ flex: 1, minWidth: 210 }}>
                  <div
                    style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 11,
                      color: accentColor,
                      letterSpacing: 2,
                      marginBottom: 6,
                    }}
                  >
                    PROCESSING {engineLabel} {modeLabel}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{currentStep}</div>
                  <div
                    style={{
                      marginTop: 12,
                      height: 3,
                      background: "rgba(255,255,255,0.08)",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${progress}%`,
                        background: accentColor,
                        borderRadius: 4,
                        transition: "width 0.3s ease",
                        boxShadow: `0 0 8px ${accentColor}`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.68)" }}>
            STEM PLAYERS
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>
            Estos volúmenes afectan al reproductor de stems, no al secuenciador.
          </div>
        </div>

        <div className="stems-grid">
          {STEMS.map((stem) => (
            <StemCard
              key={stem.id}
              stem={stem}
              ready={ready}
              playing={playing}
              stemUrl={stems[stem.id]}
              volume={volumes[stem.id]}
              onPlay={playStem}
              onPause={pauseStem}
              onVolumeChange={setStemVolume}
              downloadName={`${baseName}_${stem.id}.mp3`}
            />
          ))}
        </div>

        {file && (
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              padding: "16px 18px",
              marginBottom: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", letterSpacing: 2, fontSize: 10, color: "rgba(255,255,255,0.72)" }}>
                  SEQUENCER PATTERN
                </div>
                {patternStatus === "done" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {[2, 4].map((bars) => (
                      <button
                        key={bars}
                        type="button"
                        onClick={() => setPatternBars(bars)}
                        style={{
                          border: `1px solid ${patternBars === bars ? accentColor : "rgba(255,255,255,0.2)"}`,
                          color: patternBars === bars ? accentColor : "rgba(255,255,255,0.65)",
                          background: "transparent",
                          borderRadius: 999,
                          fontSize: 10,
                          letterSpacing: 1,
                          padding: "4px 9px",
                          cursor: "pointer",
                          fontFamily: "'Space Mono', monospace",
                        }}
                      >
                        {bars} BARS
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPatternMode("extract")}
                      style={{
                        border: `1px solid ${patternMode === "extract" ? accentColor : "rgba(255,255,255,0.2)"}`,
                        color: patternMode === "extract" ? accentColor : "rgba(255,255,255,0.65)",
                        background: "transparent",
                        borderRadius: 999,
                        fontSize: 10,
                        letterSpacing: 1,
                        padding: "4px 9px",
                        cursor: "pointer",
                        fontFamily: "'Space Mono', monospace",
                      }}
                    >
                      ANALYZE
                    </button>
                    <button
                      type="button"
                      onClick={toggleCreativeTools}
                      style={{
                        border: `1px solid ${creativeToolsVisible ? "rgba(120,216,112,0.5)" : "rgba(255,255,255,0.2)"}`,
                        color: creativeToolsVisible ? "#78d870" : "rgba(255,255,255,0.65)",
                        background: "transparent",
                        borderRadius: 999,
                        fontSize: 10,
                        letterSpacing: 1,
                        padding: "4px 9px",
                        cursor: "pointer",
                        fontFamily: "'Space Mono', monospace",
                      }}
                    >
                      {creativeToolsVisible ? "HIDE CREATIVE" : "SHOW CREATIVE"}
                    </button>
                    {creativeToolsVisible && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPatternMode("generate")}
                          style={{
                            border: `1px solid ${patternMode === "generate" ? "#78d870" : "rgba(255,255,255,0.2)"}`,
                            color: patternMode === "generate" ? "#78d870" : "rgba(255,255,255,0.65)",
                            background: "transparent",
                            borderRadius: 999,
                            fontSize: 10,
                            letterSpacing: 1,
                            padding: "4px 9px",
                            cursor: "pointer",
                            fontFamily: "'Space Mono', monospace",
                          }}
                        >
                          GENERATE
                        </button>
                        <button
                          type="button"
                          onClick={regeneratePattern}
                          style={{
                            border: "1px solid rgba(120,216,112,0.32)",
                            color: "rgba(180,255,172,0.88)",
                            background: "transparent",
                            borderRadius: 999,
                            fontSize: 10,
                            letterSpacing: 1,
                            padding: "4px 9px",
                            cursor: "pointer",
                            fontFamily: "'Space Mono', monospace",
                          }}
                        >
                          REGENERATE
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={toggleSequencer}
                      style={{
                        border: `1px solid ${sequencerPlaying ? accentColor : "rgba(255,255,255,0.25)"}`,
                        color: sequencerPlaying ? accentColor : "rgba(255,255,255,0.75)",
                        background: "transparent",
                        borderRadius: 999,
                        fontSize: 10,
                        letterSpacing: 1,
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontFamily: "'Space Mono', monospace",
                      }}
                    >
                      {sequencerPlaying ? "PAUSE SEQ" : "PLAY SEQ"}
                    </button>
                  </div>
                )}
              </div>

              {patternBpm ? (
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: accentColor }}>
                  EST BPM {patternBpm}
                </div>
              ) : null}
            </div>

            <div
              style={{
                marginBottom: 10,
                border: "1px solid rgba(120,216,112,0.18)",
                background: "rgba(120,216,112,0.06)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 11,
                color: "rgba(255,255,255,0.62)",
              }}
            >
              Los controles Mute, Solo y Vol de esta sección solo afectan al secuenciador y a su mezcla interna.
            </div>

            {analyzingPatterns && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                Analizando transientes y construyendo grid de 16 pasos...
              </div>
            )}

            {patternStatus === "error" && (
              <div style={{ fontSize: 12, color: "rgba(232,84,71,0.88)" }}>{patternError}</div>
            )}

            {patternStatus === "done" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 2 }}>
                  {patternMode === "extract"
                    ? `Analyze mode: ${patternBars} compases, onsets reales por stem e intensidad normalizada por paso.`
                    : `Generate mode: patron sintetico Euclidean + Markov derivado del analisis de ${patternBars} compases.`}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginBottom: 2 }}>
                  Mute, Solo y Vol solo afectan al secuenciador. Para microtiming real del stem de drums, usa Groove Extractor.
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color:
                      sequencerMixStatus.tone === "warning"
                        ? "rgba(232,84,71,0.88)"
                        : sequencerMixStatus.tone === "accent"
                          ? accentColor
                          : "rgba(255,255,255,0.5)",
                    marginBottom: 4,
                    fontFamily: "'Space Mono', monospace",
                  }}
                >
                  {sequencerMixStatus.text}
                </div>
                {displayedPatterns.original ? (
                  <PatternRow
                    label="ORIGINAL"
                    color="#f1f1f1"
                    steps={displayedPatterns.original}
                    playheadStep={playheadStep}
                    isPlaying={sequencerPlaying}
                    muted={sequencerMute.original}
                    effectivelyMuted={hasSequencerSolo ? !sequencerSolo.original : sequencerMute.original}
                    solo={sequencerSolo.original}
                    onToggleMute={() => toggleSequencerMute("original")}
                    onToggleSolo={() => toggleSequencerSolo("original")}
                    level={sequencerLevels.original}
                    onLevelChange={(value) => setSequencerLevel("original", value)}
                  />
                ) : null}
                {STEMS.map((stem) =>
                  displayedPatterns[stem.id] ? (
                    <PatternRow
                      key={stem.id}
                      label={stem.label}
                      color={stem.color}
                      steps={displayedPatterns[stem.id]}
                      playheadStep={playheadStep}
                      isPlaying={sequencerPlaying}
                      muted={sequencerMute[stem.id]}
                      effectivelyMuted={hasSequencerSolo ? !sequencerSolo[stem.id] : sequencerMute[stem.id]}
                      solo={sequencerSolo[stem.id]}
                      onToggleMute={() => toggleSequencerMute(stem.id)}
                      onToggleSolo={() => toggleSequencerSolo(stem.id)}
                      level={sequencerLevels[stem.id]}
                      onLevelChange={(value) => setSequencerLevel(stem.id, value)}
                    />
                  ) : null,
                )}
              </div>
            )}

            {patternStatus === "idle" && !processing && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.46)" }}>
                Procesa el track para ver patrones aproximados de cada stem en formato sequencer.
              </div>
            )}
          </div>
        )}

        {ready && <GrooveComparison stemUrls={stems} />}

        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14,
            padding: "18px 20px",
            fontSize: 12,
            color: "rgba(255,255,255,0.45)",
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontFamily: "'Space Mono', monospace", letterSpacing: 2, fontSize: 10, marginBottom: 8 }}>
            ENGINE NOTES
          </div>
          This build uses remote separation through Modal. Set <code>NEXT_PUBLIC_MODAL_SEPARATE_URL</code> in Vercel with your deployed endpoint URL to enable processing.
        </div>
      </div>
    </div>
  );
}

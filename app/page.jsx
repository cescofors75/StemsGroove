"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

  const bpmCandidates = [];
  for (let i = 1; i < onsetTimes.length; i += 1) {
    const interval = onsetTimes[i] - onsetTimes[i - 1];
    if (interval < 0.08 || interval > 1.2) {
      continue;
    }

    let bpm = 60 / interval;
    while (bpm < 75) {
      bpm *= 2;
    }
    while (bpm > 170) {
      bpm /= 2;
    }
    bpmCandidates.push(bpm);
  }

  const bpm = median(bpmCandidates);
  return bpm || 120;
}

function getPatternWindow(totalSeconds, bpm, steps = 16) {
  const beatDuration = 60 / Math.max(1, bpm);
  const barDuration = beatDuration * 4;
  const analysisDuration = Math.max(0.5, Math.min(barDuration, totalSeconds));
  const stepDuration = analysisDuration / steps;
  return { analysisDuration, stepDuration };
}

function buildStepPattern(mono, sampleRate, bpm, steps = 16) {
  const availableSeconds = mono.length / sampleRate;
  const { stepDuration } = getPatternWindow(availableSeconds, bpm, steps);

  const energies = Array.from({ length: steps }).map((_, step) => {
    const start = Math.floor(step * stepDuration * sampleRate);
    const end = Math.min(mono.length, Math.floor((step + 1) * stepDuration * sampleRate));
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      sum += mono[i] * mono[i];
    }
    return Math.sqrt(sum / Math.max(1, end - start));
  });

  const maxEnergy = Math.max(...energies, 1e-9);
  const normalized = energies.map((value) => value / maxEnergy);
  let binary = normalized.map((value) => (value >= 0.33 ? 1 : 0));

  if (binary.every((value) => value === 0)) {
    const strongest = normalized
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4)
      .map((item) => item.index);
    binary = binary.map((_, index) => (strongest.includes(index) ? 1 : 0));
  }

  return binary;
}

function countHits(pattern = []) {
  return pattern.reduce((acc, step) => acc + (step ? 1 : 0), 0);
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

    if (current === 1) {
      const dropChance = 0.06 + intensity * 0.28 - neighborhood * 0.015;
      out[i] = r < dropChance ? 0 : 1;
    } else {
      const riseChance = 0.03 + intensity * 0.22 + neighborhood * 0.06;
      out[i] = r < riseChance ? 1 : 0;
    }
  }

  if (out.every((step) => step === 0)) {
    const strongest = pattern.findIndex((step) => step === 1);
    out[strongest >= 0 ? strongest : 0] = 1;
  }

  return out;
}

function generatePatternSet(extractedPatterns, seed = 1) {
  if (!extractedPatterns || !Object.keys(extractedPatterns).length) {
    return {};
  }

  const generated = {};
  const sourceDrums = extractedPatterns.drums || Array.from({ length: 16 }).map(() => 0);
  const drumHits = Math.max(3, Math.min(10, countHits(sourceDrums) || 4));
  const euclidean = buildEuclideanPattern(16, drumHits, seed % 16);
  const markovDrums = markovMutatePattern(sourceDrums, 100 + seed, 0.2);

  generated.original = markovMutatePattern(extractedPatterns.original || euclidean, 11 + seed, 0.16);
  generated.drums = euclidean.map((step, index) => (step || markovDrums[index] ? 1 : 0));
  generated.vocals = markovMutatePattern(extractedPatterns.vocals || generated.original, 23 + seed, 0.24);
  generated.bass = markovMutatePattern(extractedPatterns.bass || generated.original, 37 + seed, 0.18);
  generated.other = markovMutatePattern(extractedPatterns.other || generated.original, 51 + seed, 0.28);

  return generated;
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
              height: 3,
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

function PatternRow({ label, color, steps, playheadStep = -1, isPlaying = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 12, alignItems: "center" }}>
      <div
        style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: 10,
          letterSpacing: 1.5,
          color,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(16, minmax(0, 1fr))", gap: 4 }}>
        {steps.map((value, index) => (
          <div
            key={`${label}-${index}`}
            style={{
              height: 18,
              borderRadius: 4,
              border: `1px solid ${
                isPlaying && playheadStep === index
                  ? "rgba(255,255,255,0.95)"
                  : value
                    ? `${color}88`
                    : "rgba(255,255,255,0.12)"
              }`,
              background: value ? `${color}55` : "rgba(255,255,255,0.03)",
              boxShadow:
                isPlaying && playheadStep === index
                  ? `0 0 0 1px rgba(255,255,255,0.5), 0 0 10px ${color}44 inset`
                  : value
                    ? `0 0 8px ${color}33 inset`
                    : "none",
            }}
          />
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
  const [sequencerPlaying, setSequencerPlaying] = useState(false);
  const [playheadStep, setPlayheadStep] = useState(-1);
  const [separateMode, setSeparateMode] = useState("fast");
  const [volumes, setVolumes] = useState({ vocals: 85, drums: 85, bass: 85, other: 85 });

  const audioRef = useRef(null);
  const fileRef = useRef(null);
  const sequencerTimerRef = useRef(null);
  const sequencerAudioCtxRef = useRef(null);
  const sequencerSourcesRef = useRef({});

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

  const generatedPatterns = useMemo(() => generatePatternSet(patterns, generationSeed), [patterns, generationSeed]);
  const displayedPatterns = patternMode === "generate" ? generatedPatterns : patterns;

  const stopSequencer = useCallback(() => {
    if (sequencerTimerRef.current) {
      clearInterval(sequencerTimerRef.current);
      sequencerTimerRef.current = null;
    }
    setSequencerPlaying(false);
    setPlayheadStep(-1);
  }, []);

  const triggerSequencerSlice = useCallback((audioContext, voiceId, step, time) => {
    const sourceInfo = sequencerSourcesRef.current[voiceId];
    if (!sourceInfo?.buffer || !sourceInfo.stepDuration) {
      return;
    }

    const offset = step * sourceInfo.stepDuration;
    const maxDuration = Math.max(0, sourceInfo.buffer.duration - offset);
    const duration = Math.min(sourceInfo.stepDuration * 0.94, maxDuration);
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

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(baseGain, time + 0.005);
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
    const tick = () => {
      setPlayheadStep(step);

      for (const key of keys) {
        const row = displayedPatterns[key];
        if (row?.[step]) {
          triggerSequencerSlice(audioContext, key, step, audioContext.currentTime + 0.005);
        }
      }

      step = (step + 1) % 16;
    };

    tick();
    sequencerTimerRef.current = setInterval(tick, stepMs);
  }, [displayedPatterns, patternBpm, patternStatus, sequencerPlaying, stopSequencer, triggerSequencerSlice]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const onEnded = () => setPlaying(null);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.src = "";
      audio.removeEventListener("ended", onEnded);
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

  useEffect(
    () => () => {
      if (originalUrl) {
        URL.revokeObjectURL(originalUrl);
      }
    },
    [originalUrl],
  );

  const playSource = async (sourceId, sourceUrl, volume = 1) => {
    const player = audioRef.current;
    if (!player || !sourceUrl) {
      return;
    }

    if (sequencerPlaying) {
      stopSequencer();
    }

    if (playing === sourceId && !player.paused) {
      player.pause();
      setPlaying(null);
      return;
    }

    player.pause();
    player.src = sourceUrl;
    player.currentTime = 0;
    player.volume = volume;

    try {
      await player.play();
      setPlaying(sourceId);
    } catch {
      setError("No se pudo iniciar la reproduccion.");
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
      const originalWindow = getPatternWindow(originalBuffer.duration, bpm, 16);

      const nextPatterns = {
        original: buildStepPattern(originalMono, originalBuffer.sampleRate, bpm),
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
        nextPatterns[stem.id] = buildStepPattern(stemMono, stemBuffer.sampleRate, bpm);
        sourceMap[stem.id] = {
          buffer: stemBuffer,
          stepDuration: getPatternWindow(stemBuffer.duration, bpm, 16).stepDuration,
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
    if (!incoming || !ACCEPT_AUDIO.test(incoming.name)) {
      setError("Formato no soportado. Usa WAV, MP3, FLAC o AIFF.");
      return;
    }

    if (originalUrl) {
      URL.revokeObjectURL(originalUrl);
    }

    const localUrl = URL.createObjectURL(incoming);

    setError("");
    setFile(incoming);
    setOriginalUrl(localUrl);
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
    sequencerSourcesRef.current = {};
    stopSequencer();
    setPlaying(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
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
    setOriginalUrl("");
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
    sequencerSourcesRef.current = {};
    stopSequencer();
    setPlaying(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
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
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", separateMode);

      const response = await fetch("/api/separate", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "No se pudo procesar el archivo.");
      }

      setStems(payload.stems || {});
      setProgress(100);
      setCurrentStep("Stems ready");
      setStatus("done");
      await createPatterns(file, payload.stems || {});
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

  const pauseStem = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlaying(null);
  };

  const setStemVolume = (stemId, value) => {
    setVolumes((prev) => ({ ...prev, [stemId]: value }));
  };

  const regeneratePattern = () => {
    setGenerationSeed((seed) => seed + 1);
    setPatternMode("generate");
  };

  const baseName = useMemo(() => {
    if (!file) {
      return "track";
    }
    return file.name.replace(/\.[^.]+$/, "");
  }, [file]);

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
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
          height: 3px;
        }

        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          cursor: pointer;
          border: none;
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
            Upload a full mix and split it into vocals, drums, bass and other using Demucs HTDemucs through
            built-in Next.js API routes.
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

        {file && !ready && (
          <div style={{ marginBottom: 24 }}>
            {!processing && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
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
                PROCESS WITH DEMUCS ({modeLabel})
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
                    PROCESSING {modeLabel}
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
                      EXTRACT
                    </button>
                    <button
                      type="button"
                      onClick={() => setPatternMode("generate")}
                      style={{
                        border: `1px solid ${patternMode === "generate" ? accentColor : "rgba(255,255,255,0.2)"}`,
                        color: patternMode === "generate" ? accentColor : "rgba(255,255,255,0.65)",
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
                        border: "1px solid rgba(255,255,255,0.25)",
                        color: "rgba(255,255,255,0.75)",
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
                    ? "Extract mode: groove detectado desde onsets/transientes."
                    : "Generate mode: variacion Euclidean + Markov sobre el groove extraido."}
                </div>
                {displayedPatterns.original ? (
                  <PatternRow
                    label="ORIGINAL"
                    color="#f1f1f1"
                    steps={displayedPatterns.original}
                    playheadStep={playheadStep}
                    isPlaying={sequencerPlaying}
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
          Demucs runs server-side through <code>/api/separate</code>. Output files are stored temporarily under
          <code> .stems/</code> and streamed by <code>/api/stems/[runId]/[stem]</code>.
        </div>
      </div>
    </div>
  );
}

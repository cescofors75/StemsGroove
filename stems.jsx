import { useState, useRef, useCallback, useEffect } from "react";

const STEMS = [
  {
    id: "vocals",
    label: "VOCALS",
    icon: "🎤",
    color: "#e8c547",
    bg: "rgba(232,197,71,0.08)",
    border: "rgba(232,197,71,0.3)",
    desc: "Lead & backing vocals",
  },
  {
    id: "drums",
    label: "DRUMS",
    icon: "🥁",
    color: "#e85447",
    bg: "rgba(232,84,71,0.08)",
    border: "rgba(232,84,71,0.3)",
    desc: "Kick, snare, hi-hats & percussion",
  },
  {
    id: "bass",
    label: "BASS",
    icon: "🎸",
    color: "#47b8e8",
    bg: "rgba(71,184,232,0.08)",
    border: "rgba(71,184,232,0.3)",
    desc: "Bass guitar & sub frequencies",
  },
  {
    id: "other",
    label: "OTHER",
    icon: "🎹",
    color: "#a047e8",
    bg: "rgba(160,71,232,0.08)",
    border: "rgba(160,71,232,0.3)",
    desc: "Guitars, synths & instruments",
  },
];

const WaveformBars = ({ color, active, small }) => {
  const count = small ? 24 : 48;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: small ? 2 : 3, height: small ? 32 : 48 }}>
      {Array.from({ length: count }).map((_, i) => {
        const height = active
          ? Math.random() > 0.5
            ? 20 + Math.random() * 80
            : 10 + Math.random() * 40
          : 15 + Math.sin(i * 0.4) * 10 + Math.cos(i * 0.7) * 8;
        return (
          <div
            key={i}
            style={{
              width: small ? 2 : 3,
              height: `${Math.max(8, Math.min(100, height))}%`,
              background: active ? color : "rgba(255,255,255,0.15)",
              borderRadius: 2,
              transition: active ? `height ${0.1 + Math.random() * 0.3}s ease` : "none",
              animation: active ? `pulse-${i % 4} ${0.4 + (i % 7) * 0.1}s ease-in-out infinite alternate` : "none",
            }}
          />
        );
      })}
    </div>
  );
};

const AnimatedWaveform = ({ color, active, small }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, [active]);
  return <WaveformBars key={tick} color={color} active={active} small={small} />;
};

const StemCard = ({ stem, ready, playing, onPlay, onPause }) => {
  const [vol, setVol] = useState(85);
  const isPlaying = playing === stem.id;

  return (
    <div
      style={{
        background: ready ? stem.bg : "rgba(255,255,255,0.02)",
        border: `1px solid ${ready ? stem.border : "rgba(255,255,255,0.06)"}`,
        borderRadius: 12,
        padding: "20px 24px",
        transition: "all 0.4s ease",
        opacity: ready ? 1 : 0.4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>{stem.icon}</span>
          <div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: 3, color: stem.color, fontWeight: 700 }}>
              {stem.label}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{stem.desc}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {ready && (
            <>
              <button
                onClick={isPlaying ? onPause : () => onPlay(stem.id)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: `1.5px solid ${stem.color}`,
                  background: isPlaying ? stem.color : "transparent",
                  color: isPlaying ? "#000" : stem.color,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  transition: "all 0.2s",
                }}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <button
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "1.5px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                }}
                title="Download stem"
              >
                ↓
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <AnimatedWaveform color={stem.color} active={isPlaying} small />
      </div>

      {ready && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", width: 20 }}>🔈</span>
          <input
            type="range"
            min={0}
            max={100}
            value={vol}
            onChange={(e) => setVol(Number(e.target.value))}
            style={{
              flex: 1,
              accentColor: stem.color,
              height: 3,
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", width: 28, textAlign: "right" }}>
            {vol}%
          </span>
        </div>
      )}
    </div>
  );
};

const ProgressRing = ({ progress, color }) => {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (progress / 100) * circ;
  return (
    <svg width={72} height={72} viewBox="0 0 72 72">
      <circle cx={36} cy={36} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
      <circle
        cx={36} cy={36} r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dasharray 0.3s ease" }}
      />
      <text x={36} y={40} textAnchor="middle" fill="white" fontSize={13} fontFamily="monospace" fontWeight="bold">
        {progress}%
      </text>
    </svg>
  );
};

export default function StemSeparator() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | processing | done | error
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [playing, setPlaying] = useState(null);
  const fileRef = useRef();

  const handleFile = (f) => {
    if (!f || !f.name.match(/\.(wav|mp3|flac|aiff?)$/i)) return;
    setFile(f);
    setStatus("idle");
    setProgress(0);
    setPlaying(null);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  const simulateProcessing = () => {
    setStatus("processing");
    setProgress(0);
    const steps = [
      [5, "Loading audio file..."],
      [15, "Analyzing frequency spectrum..."],
      [30, "Running Demucs HTDemucs model..."],
      [50, "Separating vocals..."],
      [65, "Isolating drums & percussion..."],
      [78, "Extracting bass frequencies..."],
      [90, "Processing remaining instruments..."],
      [100, "Finalizing stems..."],
    ];
    let i = 0;
    const run = () => {
      if (i >= steps.length) {
        setTimeout(() => setStatus("done"), 400);
        return;
      }
      const [p, msg] = steps[i++];
      setProgress(p);
      setCurrentStep(msg);
      setTimeout(run, 600 + Math.random() * 400);
    };
    run();
  };

  const ready = status === "done";
  const processing = status === "processing";

  const accentColor = "#e8c547";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0c",
        color: "#fff",
        fontFamily: "'Inter', sans-serif",
        padding: "40px 24px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type=range] { -webkit-appearance: none; appearance: none; background: rgba(255,255,255,0.1); border-radius: 4px; height: 3px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; cursor: pointer; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: accentColor, boxShadow: `0 0 12px ${accentColor}` }} />
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 4, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
              Audio Tool v1.0
            </span>
          </div>
          <h1 style={{ fontFamily: "'Space Mono', monospace", fontSize: 28, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1 }}>
            STEM<br />
            <span style={{ color: accentColor }}>SEPARATOR</span>
          </h1>
          <p style={{ marginTop: 12, color: "rgba(255,255,255,0.4)", fontSize: 13, lineHeight: 1.6 }}>
            Powered by Meta's Demucs HTDemucs model · Separates 4 stems with high fidelity
          </p>
        </div>

        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !file && fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? accentColor : file ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 16,
            padding: file ? "20px 24px" : "40px 24px",
            marginBottom: 24,
            cursor: file ? "default" : "pointer",
            transition: "all 0.3s ease",
            background: dragging ? "rgba(232,197,71,0.04)" : "rgba(255,255,255,0.02)",
            display: "flex",
            alignItems: "center",
            justifyContent: file ? "space-between" : "center",
            flexDirection: file ? "row" : "column",
            gap: 16,
          }}
        >
          <input ref={fileRef} type="file" accept=".wav,.mp3,.flac,.aif,.aiff" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />

          {!file ? (
            <>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🎵</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                DROP YOUR AUDIO FILE HERE
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                WAV · MP3 · FLAC · AIFF
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(232,197,71,0.1)", border: "1px solid rgba(232,197,71,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                  🎵
                </div>
                <div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#fff", fontWeight: 700 }}>{file.name}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setStatus("idle"); setPlaying(null); }}
                style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}
              >
                ✕ Clear
              </button>
            </>
          )}
        </div>

        {/* Process button / progress */}
        {file && !ready && (
          <div style={{ marginBottom: 28 }}>
            {!processing ? (
              <button
                onClick={simulateProcessing}
                style={{
                  width: "100%",
                  padding: "16px",
                  background: accentColor,
                  color: "#000",
                  border: "none",
                  borderRadius: 12,
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 2,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                ▶ SEPARATE STEMS
              </button>
            ) : (
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "20px 24px", display: "flex", alignItems: "center", gap: 20 }}>
                <ProgressRing progress={progress} color={accentColor} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: accentColor, letterSpacing: 2, marginBottom: 6 }}>
                    PROCESSING
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{currentStep}</div>
                  <div style={{ marginTop: 12, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: accentColor, borderRadius: 4, transition: "width 0.4s ease", boxShadow: `0 0 8px ${accentColor}` }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stems grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 32 }}>
          {STEMS.map((stem) => (
            <StemCard
              key={stem.id}
              stem={stem}
              ready={ready}
              playing={playing}
              onPlay={(id) => setPlaying(id)}
              onPause={() => setPlaying(null)}
            />
          ))}
        </div>

        {/* Backend instructions */}
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "28px 28px", marginTop: 8 }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>
            BACKEND SETUP
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, marginBottom: 20 }}>
            This UI requires a Python backend running Demucs. Follow these steps:
          </div>

          {[
            {
              step: "01",
              title: "Install dependencies",
              code: `pip install demucs fastapi uvicorn python-multipart`,
              color: "#e8c547",
            },
            {
              step: "02",
              title: "Create backend (main.py)",
              code: `from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import demucs.separate, tempfile, shutil, os

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

@app.post("/separate")
async def separate(file: UploadFile):
    with tempfile.TemporaryDirectory() as tmp:
        input_path = f"{tmp}/{file.filename}"
        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        demucs.separate.main([
            "--mp3", "-n", "htdemucs",
            "-o", tmp, input_path
        ])
        # Returns stems: vocals, drums, bass, other
        stems = {}
        out_dir = f"{tmp}/htdemucs/{os.path.splitext(file.filename)[0]}"
        for stem in ["vocals","drums","bass","other"]:
            stems[stem] = f"{out_dir}/{stem}.mp3"
        return {"stems": stems}`,
              color: "#47b8e8",
            },
            {
              step: "03",
              title: "Run the server",
              code: `uvicorn main:app --reload --port 8000`,
              color: "#a047e8",
            },
            {
              step: "04",
              title: "Connect this UI",
              code: `// Replace simulateProcessing() with:
const res = await fetch("http://localhost:8000/separate", {
  method: "POST",
  body: formData  // FormData with audio file
});
const { stems } = await res.json();`,
              color: "#e85447",
            },
          ].map(({ step, title, code, color }) => (
            <div key={step} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color, letterSpacing: 1 }}>{step}</span>
                <div style={{ flex: 1, height: 1, background: `${color}22` }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{title}</span>
              </div>
              <pre
                style={{
                  background: "#0d0d10",
                  border: `1px solid ${color}22`,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 8,
                  padding: "14px 16px",
                  fontSize: 11,
                  fontFamily: "'Space Mono', monospace",
                  color: "rgba(255,255,255,0.65)",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.7,
                }}
              >
                {code}
              </pre>
            </div>
          ))}

          <div style={{ marginTop: 8, padding: "12px 16px", background: "rgba(160,71,232,0.06)", border: "1px solid rgba(160,71,232,0.2)", borderRadius: 8, fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
            💡 <strong style={{ color: "rgba(255,255,255,0.6)" }}>Tip:</strong> El modelo <code style={{ color: "#a047e8" }}>htdemucs</code> es el más preciso. Para más velocidad usa <code style={{ color: "#a047e8" }}>mdx_extra</code>. Con GPU (CUDA) la separación tarda ~30s por canción; con CPU ~5-10 min.
          </div>
        </div>
      </div>
    </div>
  );
}

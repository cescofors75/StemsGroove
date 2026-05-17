import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextResponse } from "next/server";
import { corsHeaders, handlePreflight } from "../../../lib/cors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return handlePreflight(request);
}

const STEM_NAMES = ["vocals", "drums", "bass", "other"];
const VALID_AUDIO_EXT = /\.(wav|mp3|flac|aiff?)$/i;
const PROCESS_MODES = {
  fast: {
    modelName: "mdx_extra",
    mp3Bitrate: "192",
    mp3Preset: "7",
  },
  balanced: {
    modelName: "htdemucs",
    mp3Bitrate: "224",
    mp3Preset: "4",
  },
  quality: {
    modelName: "htdemucs",
    mp3Bitrate: "320",
    mp3Preset: "2",
  },
};

function collectWindowsFfmpegBins() {
  if (process.platform !== "win32") {
    return [];
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return [];
  }

  const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  if (!existsSync(packagesRoot)) {
    return [];
  }

  const bins = [];
  const packageDirs = readdirSync(packagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  for (const dir of packageDirs) {
    const name = dir.name.toLowerCase();
    if (!name.includes("ffmpeg")) {
      continue;
    }

    const root = path.join(packagesRoot, dir.name);
    const directBin = path.join(root, "bin");
    if (existsSync(path.join(directBin, "ffmpeg.exe"))) {
      bins.push(directBin);
    }

    const nested = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const child of nested) {
      const nestedBin = path.join(root, child.name, "bin");
      if (existsSync(path.join(nestedBin, "ffmpeg.exe"))) {
        bins.push(nestedBin);
      }
    }
  }

  return [...new Set(bins)];
}

const EXTRA_FFMPEG_BINS = collectWindowsFfmpegBins();

function normalizeDemucsError(rawMessage) {
  const message = String(rawMessage || "");

  if (message.includes("No module named 'demucs'")) {
    return "Demucs is not installed for the Python interpreter used by Next.js. Run: py -m pip install demucs";
  }

  if (message.toLowerCase().includes("ffmpeg")) {
    return "FFmpeg was not found. Install FFmpeg and ensure it is available in PATH.";
  }

  if (message.includes("TorchCodec is required") || message.includes("Could not load libtorchcodec")) {
    return "Demucs could not decode audio because FFmpeg was unavailable for the running process. Restart Next.js dev server after installing FFmpeg (shared build), then try again.";
  }

  if (message.includes("WinError 2") || message.includes("ENOENT")) {
    return "Python runtime not found. Install Python and ensure 'python' or 'py' is available in PATH.";
  }

  return message;
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const mergedPath = [...EXTRA_FFMPEG_BINS, process.env.PATH || ""].join(path.delimiter);

    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: mergedPath,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Command failed (${command} ${args.join(" ")}):\n${stderr || stdout}`));
    });
  });
}

function getVenvPython() {
  const venvPython =
    process.platform === "win32"
      ? path.join(process.cwd(), ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), ".venv", "bin", "python");
  return existsSync(venvPython) ? venvPython : null;
}

async function runDemucs(inputPath, outputRoot, cwd, mode) {
  const demucsArgs = [
    "-m",
    "demucs.separate",
    "--mp3",
    "--mp3-bitrate",
    mode.mp3Bitrate,
    "--mp3-preset",
    mode.mp3Preset,
    "-n",
    mode.modelName,
    "-o",
    outputRoot,
    inputPath,
  ];

  // Prefer the project's venv Python (has demucs installed)
  const venvPython = getVenvPython();
  if (venvPython) {
    try {
      await runCommand(venvPython, demucsArgs, cwd);
      return;
    } catch (error) {
      throw new Error(normalizeDemucsError(error instanceof Error ? error.message : String(error)));
    }
  }

  // Fallback: try system python / py launcher
  let firstError;
  try {
    await runCommand("python", demucsArgs, cwd);
    return;
  } catch (error) {
    firstError = error;
  }

  try {
    await runCommand("py", demucsArgs, cwd);
  } catch (error) {
    const combined = `${firstError instanceof Error ? firstError.message : ""}\n${
      error instanceof Error ? error.message : ""
    }`;
    throw new Error(normalizeDemucsError(combined));
  }
}

async function findTrackDirectory(modelOutputDir) {
  const entries = await fs.readdir(modelOutputDir, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());
  if (folders.length === 0) {
    throw new Error("Demucs did not produce an output folder for this track.");
  }
  return path.join(modelOutputDir, folders[0].name);
}

export async function POST(request) {
  if (request.method === "OPTIONS") return handlePreflight(request);
  let tempDir = "";

  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    const modeInput = String(formData.get("mode") || "fast").toLowerCase();
    const modeKey = PROCESS_MODES[modeInput] ? modeInput : "fast";
    const mode = PROCESS_MODES[modeKey];

    if (!(uploaded instanceof File)) {
      return NextResponse.json({ error: "Missing file field in form data." }, { status: 400 });
    }

    if (!VALID_AUDIO_EXT.test(uploaded.name)) {
      return NextResponse.json(
        { error: "Unsupported format. Use WAV, MP3, FLAC, or AIFF." },
        { status: 400 },
      );
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stems-"));
    const inputPath = path.join(tempDir, uploaded.name);
    const outputRoot = path.join(tempDir, "out");

    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(inputPath, Buffer.from(await uploaded.arrayBuffer()));

    await runDemucs(inputPath, outputRoot, tempDir, mode);

    const modelOutputDir = path.join(outputRoot, mode.modelName);
    const trackDir = await findTrackDirectory(modelOutputDir);

    const runId = crypto.randomUUID();
    const runDir = path.join(process.cwd(), ".stems", runId);
    await fs.mkdir(runDir, { recursive: true });

    const stems = {};
    for (const stem of STEM_NAMES) {
      const source = path.join(trackDir, `${stem}.mp3`);
      const destination = path.join(runDir, `${stem}.mp3`);
      await fs.copyFile(source, destination);
      stems[stem] = `/api/stems/${runId}/${stem}`;
    }

    return NextResponse.json({ runId, stems, mode: modeKey }, { headers: corsHeaders(request) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while separating stems.",
      },
      { status: 500 },
    );
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { corsHeaders, handleOptions } from "../../../lib/cors.js";

export const runtime = "nodejs";
export const maxDuration = 900;

const MODEL_STEMS = {
  htdemucs: ["vocals", "drums", "bass", "other"],
  htdemucs_ft: ["vocals", "drums", "bass", "other"],
  mdx_extra: ["vocals", "drums", "bass", "other"],
  htdemucs_6s: ["vocals", "drums", "bass", "guitar", "piano", "other"],
};

const ALLOWED_MODELS = Object.keys(MODEL_STEMS);
// These directory names are built from arrays/variables instead of inline
// string literals so bundler static-asset analysis (Turbopack/webpack file
// tracing) doesn't try to statically walk them: .stems is written to at
// request time, and .venv contains a Python interpreter symlink chain that
// can crash that tracer.
const STEMS_DIRNAME = [".", "stems"].join("");
const VENV_DIRNAME = [".", "venv"].join("");
const STEMS_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), STEMS_DIRNAME);
const MAX_RUN_AGE_MS = 2 * 60 * 60 * 1000;

function resolveVenvPath(...segments) {
  return path.join(/* turbopackIgnore: true */ process.cwd(), VENV_DIRNAME, ...segments);
}

function resolvePythonBin() {
  const winVenv = resolveVenvPath("Scripts", "python.exe");
  const posixVenv = resolveVenvPath("bin", "python3");
  const posixVenvAlt = resolveVenvPath("bin", "python");

  if (process.platform === "win32" && fsSync.existsSync(winVenv)) {
    return winVenv;
  }
  if (process.platform !== "win32" && fsSync.existsSync(posixVenv)) {
    return posixVenv;
  }
  if (process.platform !== "win32" && fsSync.existsSync(posixVenvAlt)) {
    return posixVenvAlt;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function runDemucs(pythonBin, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { cwd });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`No se pudo iniciar Python ('${pythonBin}'): ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `demucs.separate salio con codigo ${code}`));
      }
    });
  });
}

async function cleanupOldRuns() {
  let entries;
  try {
    entries = await fs.readdir(STEMS_ROOT, { withFileTypes: true });
  } catch {
    return;
  }

  const now = Date.now();
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dirPath = path.join(STEMS_ROOT, entry.name);
        const stat = await fs.stat(dirPath).catch(() => null);
        if (stat && now - stat.mtimeMs > MAX_RUN_AGE_MS) {
          await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});
        }
      }),
  );
}

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function POST(request) {
  const origin = request.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Solicitud invalida" }, { status: 400, headers });
  }

  const file = form.get("file");
  const modelRaw = String(form.get("mode") || form.get("model") || "htdemucs_6s");
  const model = ALLOWED_MODELS.includes(modelRaw) ? modelRaw : "htdemucs_6s";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo de audio" }, { status: 400, headers });
  }

  cleanupOldRuns().catch(() => {});

  const runId = randomUUID();
  const runDir = path.join(STEMS_ROOT, runId);
  const inputDir = path.join(runDir, "input");
  const outputDir = path.join(runDir, "output");
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(file.name || "");
  const ext = extMatch ? extMatch[0] : ".wav";
  const inputPath = path.join(inputDir, `track${ext}`);

  try {
    await fs.mkdir(inputDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buffer);

    const pythonBin = resolvePythonBin();
    await runDemucs(
      pythonBin,
      ["-m", "demucs.separate", "-n", model, "--mp3", "--mp3-bitrate", "224", "-o", outputDir, inputPath],
      process.cwd(),
    );

    const stemNames = MODEL_STEMS[model];
    const sourceDir = path.join(outputDir, model, "track");
    const stems = {};

    for (const stemName of stemNames) {
      const sourcePath = path.join(sourceDir, `${stemName}.mp3`);
      if (fsSync.existsSync(sourcePath)) {
        const destPath = path.join(runDir, `${stemName}.mp3`);
        await fs.rename(sourcePath, destPath);
        stems[stemName] = `/api/stems/${runId}/${stemName}`;
      }
    }

    await fs.rm(inputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});

    if (!Object.keys(stems).length) {
      throw new Error("Demucs no genero ningun stem. Revisa que el archivo de audio sea valido.");
    }

    return NextResponse.json({ runId, model, mode: model, stems }, { headers });
  } catch (error) {
    await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    const notInstalled = /ENOENT|No module named .?demucs|not found|no se pudo iniciar python/i.test(message);

    return NextResponse.json(
      {
        error: notInstalled
          ? "El motor local no esta instalado. Ejecuta el instalador (install.bat en Windows o install.sh en Mac/Linux) o cambia a modo Nube."
          : "Fallo la separacion local de audio",
        detail: message,
      },
      { status: notInstalled ? 501 : 500, headers },
    );
  }
}

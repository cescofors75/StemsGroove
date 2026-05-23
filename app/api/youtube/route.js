import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const maxDuration = 300;

const YT_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|live\/)|youtu\.be\/)[\w-]+/;

function sanitizeFilename(name) {
  return (
    name
      .replace(/[^\w\s.\-()[\]]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(0, 100)
      .trim() || "youtube_audio"
  );
}

export async function POST(request) {
  let tmpDir;
  try {
    const body = await request.json();
    const url = (body?.url || "").trim();

    if (!url || !YT_REGEX.test(url)) {
      return NextResponse.json(
        { error: "URL de YouTube no válida" },
        { status: 400 }
      );
    }

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ytdl-"));
    const outputTemplate = path.join(tmpDir, "%(title)s.%(ext)s");

    await execFileAsync(
      "yt-dlp",
      [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--no-playlist",
        "--max-filesize", "150m",
        "--socket-timeout", "30",
        "--no-warnings",
        "-o", outputTemplate,
        url,
      ],
      { timeout: 240000 }
    );

    const files = await fs.readdir(tmpDir);
    const mp3File = files.find((f) => f.endsWith(".mp3"));

    if (!mp3File) {
      throw new Error("No se pudo extraer el audio MP3");
    }

    const filePath = path.join(tmpDir, mp3File);
    const fileBuffer = await fs.readFile(filePath);
    const safeName =
      sanitizeFilename(path.basename(mp3File, ".mp3")) + ".mp3";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Filename": safeName,
      },
    });
  } catch (err) {
    const msg = String(err?.stderr || err?.stdout || err?.message || "");
    let userError = "Error al descargar el audio de YouTube";
    if (
      msg.includes("unavailable") ||
      msg.includes("private") ||
      msg.includes("not available")
    ) {
      userError = "Video no disponible o privado";
    } else if (msg.includes("age") || msg.includes("sign in")) {
      userError = "Video con restricción de edad";
    } else if (msg.includes("copyright") || msg.includes("blocked")) {
      userError = "Video bloqueado por derechos de autor";
    } else if (msg.includes("filesize") || msg.includes("too large")) {
      userError = "El archivo es demasiado grande (máx. 150 MB)";
    }
    return NextResponse.json({ error: userError }, { status: 500 });
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

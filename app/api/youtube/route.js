import { NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

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

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const url = (body?.url || "").trim();

    if (!url || !YT_REGEX.test(url)) {
      return NextResponse.json(
        { error: "URL de YouTube no válida" },
        { status: 400 }
      );
    }

    if (!ytdl.validateURL(url)) {
      return NextResponse.json(
        { error: "URL de YouTube no válida" },
        { status: 400 }
      );
    }

    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);

    // Prefer mp4/aac (works in all browsers incl. Safari)
    // Fall back to best audio-only (usually webm/opus)
    let format;
    let ext;
    let mimeType;

    try {
      format = ytdl.chooseFormat(info.formats, {
        filter: (f) => f.hasAudio && !f.hasVideo && f.container === "mp4",
        quality: "highestaudio",
      });
      ext = "m4a";
      mimeType = "audio/mp4";
    } catch {
      format = ytdl.chooseFormat(info.formats, {
        filter: "audioonly",
        quality: "highestaudio",
      });
      ext = format?.container === "webm" ? "webm" : "m4a";
      mimeType = ext === "webm" ? "audio/webm" : "audio/mp4";
    }

    const stream = ytdl.downloadFromInfo(info, { format });
    const buffer = await streamToBuffer(stream);
    const filename = `${title}.${ext}`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Filename": filename,
      },
    });
  } catch (err) {
    const msg = String(err?.message || "");
    let userError = "Error al descargar el audio de YouTube";
    if (msg.includes("private") || msg.includes("unavailable") || msg.includes("not available")) {
      userError = "Video no disponible o privado";
    } else if (msg.includes("age") || msg.includes("sign in")) {
      userError = "Video con restricción de edad";
    } else if (msg.includes("copyright") || msg.includes("blocked")) {
      userError = "Video bloqueado por derechos de autor";
    } else if (msg.includes("too large") || msg.includes("maxsize")) {
      userError = "El archivo de audio es demasiado grande";
    }
    return NextResponse.json({ error: userError }, { status: 500 });
  }
}

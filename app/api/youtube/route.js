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

// Derive Modal YouTube endpoint from the existing separation URL.
// Modal naming: https://{user}--demucs-separator-separate.modal.run
//            → https://{user}--demucs-separator-download-youtube.modal.run
function getModalYoutubeUrl() {
  const explicit =
    process.env.MODAL_YOUTUBE_URL ||
    process.env.NEXT_PUBLIC_MODAL_YOUTUBE_URL;
  if (explicit) return explicit;

  const separateUrl = process.env.NEXT_PUBLIC_MODAL_SEPARATE_URL || "";
  if (separateUrl.includes("-separate.modal.run")) {
    return separateUrl.replace("-separate.modal.run", "-download-youtube.modal.run");
  }
  return null;
}

async function downloadViaModal(youtubeUrl, modalUrl) {
  const res = await fetch(modalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: youtubeUrl }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Modal error ${res.status}`);
  }
  const { audio, filename } = await res.json();
  const buffer = Buffer.from(audio, "base64");
  return { buffer, filename, mimeType: "audio/mpeg" };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadViaYtdlCore(youtubeUrl) {
  if (!ytdl.validateURL(youtubeUrl)) throw new Error("URL no válida");
  const info = await ytdl.getInfo(youtubeUrl);
  const title = sanitizeFilename(info.videoDetails.title);

  let format, ext, mimeType;
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
  return { buffer, filename: `${title}.${ext}`, mimeType };
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

    const modalUrl = getModalYoutubeUrl();
    let buffer, filename, mimeType;

    if (modalUrl) {
      ({ buffer, filename, mimeType } = await downloadViaModal(url, modalUrl));
    } else {
      ({ buffer, filename, mimeType } = await downloadViaYtdlCore(url));
    }

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
    if (
      msg.includes("privado") ||
      msg.includes("unavailable") ||
      msg.includes("not available")
    ) {
      userError = "Video no disponible o privado";
    } else if (msg.includes("edad") || msg.includes("age") || msg.includes("sign in")) {
      userError = "Video con restricción de edad";
    } else if (msg.includes("copyright") || msg.includes("blocked")) {
      userError = "Video bloqueado por derechos de autor";
    }
    return NextResponse.json({ error: userError }, { status: 500 });
  }
}

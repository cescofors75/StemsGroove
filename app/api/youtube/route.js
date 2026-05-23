import { NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const maxDuration = 300;
export const runtime = "nodejs";

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
function getModalYoutubeConfig() {
  const explicit =
    process.env.MODAL_YOUTUBE_URL ||
    process.env.NEXT_PUBLIC_MODAL_YOUTUBE_URL;
  if (explicit) return { url: explicit, explicit: true };

  const separateUrl = process.env.NEXT_PUBLIC_MODAL_SEPARATE_URL || "";
  if (separateUrl.includes("-separate.modal.run")) {
    return {
      url: separateUrl.replace("-separate.modal.run", "-download-youtube.modal.run"),
      explicit: false,
    };
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
    const error = new Error(data.detail || `Modal error ${res.status}`);
    error.status = res.status;
    throw error;
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

    const modalConfig = getModalYoutubeConfig();
    let buffer, filename, mimeType;

    if (modalConfig) {
      try {
        ({ buffer, filename, mimeType } = await downloadViaModal(url, modalConfig.url));
      } catch (err) {
        if (modalConfig.explicit || err?.status !== 404) {
          throw err;
        }
        console.warn("Modal YouTube endpoint not found; falling back to local ytdl-core");
        ({ buffer, filename, mimeType } = await downloadViaYtdlCore(url));
      }
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
    let status = 502;
    if (
      msg.includes("privado") ||
      msg.includes("unavailable") ||
      msg.includes("not available")
    ) {
      userError = "Video no disponible o privado";
      status = 404;
    } else if (
      msg.includes("edad") ||
      msg.includes("age") ||
      msg.includes("sign in") ||
      msg.includes("iniciar sesión")
    ) {
      userError = "YouTube requiere iniciar sesión o verificar este video";
      status = 403;
    } else if (msg.includes("copyright") || msg.includes("blocked")) {
      userError = "Video bloqueado por derechos de autor";
      status = 403;
    }

    console.error("YouTube download failed", err);
    return NextResponse.json(
      {
        error: userError,
        detail: process.env.NODE_ENV === "development" ? msg : undefined,
      },
      { status }
    );
  }
}

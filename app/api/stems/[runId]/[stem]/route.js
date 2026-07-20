import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { corsHeaders, handleOptions } from "../../../../../lib/cors.js";

export const runtime = "nodejs";

const ALLOWED_STEMS = new Set(["vocals", "drums", "bass", "other", "guitar", "piano"]);
const RUN_ID_RE = /^[a-f0-9-]{36}$/i;

export async function OPTIONS(request) {
  return handleOptions(request);
}

export async function GET(request, context) {
  const origin = request.headers.get("origin") || "";
  const headers = corsHeaders(origin);
  const { runId, stem } = await context.params;

  if (!RUN_ID_RE.test(runId) || !ALLOWED_STEMS.has(stem)) {
    return NextResponse.json({ error: "Solicitud invalida" }, { status: 400, headers });
  }

  const filePath = path.join(process.cwd(), ".stems", runId, `${stem}.mp3`);
  if (!fsSync.existsSync(filePath)) {
    return NextResponse.json({ error: "Stem no encontrado" }, { status: 404, headers });
  }

  const buffer = await fs.readFile(filePath);
  return new NextResponse(buffer, {
    headers: {
      ...headers,
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
}

import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { corsHeaders, handlePreflight } from "../../../../../lib/cors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return handlePreflight(request);
}

const STEM_NAMES = new Set(["vocals", "drums", "bass", "other"]);
const RUN_ID_SAFE = /^[a-zA-Z0-9-]+$/;

export async function GET(_request, { params }) {
  const { runId, stem } = await params;

  if (!RUN_ID_SAFE.test(runId)) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

  if (!STEM_NAMES.has(stem)) {
    return NextResponse.json({ error: "Invalid stem name." }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), ".stems", runId, `${stem}.mp3`);

  try {
    const content = await fs.readFile(filePath);
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `inline; filename="${stem}.mp3"`,
        "Cache-Control": "no-store",
        ...corsHeaders(_request),
      },
    });
  } catch {
    return NextResponse.json({ error: "Stem not found." }, { status: 404, headers: corsHeaders(_request) });
  }
}

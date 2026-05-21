import JSZip from "jszip";

const STEMS_4 = ["vocals", "drums", "bass", "other"];
const STEMS_6 = ["vocals", "drums", "bass", "guitar", "piano", "other"];

function uint8ToBase64(data) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  return uint8ToBase64(new Uint8Array(buffer));
}

function inferMime(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (lower.endsWith(".wav")) {
    return "audio/wav";
  }
  if (lower.endsWith(".flac")) {
    return "audio/flac";
  }
  return "audio/mpeg";
}

function findStemEntry(zip, stemId) {
  const wanted = `${stemId}.`;
  return Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().includes(wanted));
}

export async function separateTrackViaModal(file, options = {}) {
  if (!(file instanceof File)) {
    throw new Error("No hay archivo valido para enviar al endpoint de separacion.");
  }

  const endpointUrl =
    options.endpointUrl ||
    process.env.NEXT_PUBLIC_MODAL_SEPARATE_URL ||
    "";

  if (!endpointUrl) {
    throw new Error("Falta NEXT_PUBLIC_MODAL_SEPARATE_URL para usar separacion remota con Modal.");
  }

  options.onProgress?.({ phase: "upload", progress: 8, label: "Preparing audio upload" });
  const audio = await fileToBase64(file);
  const model = options.model || "mdx_extra_q";
  const stemIds = model === "htdemucs_6s" ? STEMS_6 : STEMS_4;

  // eslint-disable-next-line no-console
  console.log("[modal-separator] model →", model, "| stemIds →", stemIds);

  options.onProgress?.({ phase: "upload", progress: 18, label: "Uploading track to Modal" });
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio,
      filename: file.name,
      model,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Modal separator failed (${response.status}): ${text || "sin detalle"}`);
  }

  options.onProgress?.({ phase: "download", progress: 76, label: "Downloading stems package" });
  const zipBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);

  // eslint-disable-next-line no-console
  console.log("[modal-separator] ZIP files →", Object.keys(zip.files));

  options.onProgress?.({ phase: "extract", progress: 88, label: "Extracting stems" });
  const stems = {};
  for (const stemId of stemIds) {
    const entry = findStemEntry(zip, stemId);
    if (!entry) {
      continue;
    }

    const stemData = await entry.async("uint8array");
    const blob = new Blob([stemData], { type: inferMime(entry.name) });
    stems[stemId] = URL.createObjectURL(blob);
  }

  if (Object.keys(stems).length === 0) {
    throw new Error("Modal devolvio un ZIP sin stems reconocibles.");
  }

  options.onProgress?.({ phase: "done", progress: 100, label: "Remote stems ready" });
  return stems;
}

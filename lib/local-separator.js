const STEMS_4 = ["vocals", "drums", "bass", "other"];
const STEMS_6 = ["vocals", "drums", "bass", "guitar", "piano", "other"];

export async function separateTrackLocally(file, options = {}) {
  if (!(file instanceof File)) {
    throw new Error("No hay archivo valido para procesar en el motor local.");
  }

  const model = options.model || "htdemucs_6s";
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("mode", model);

  options.onProgress?.({
    phase: "upload",
    progress: 10,
    label: "Enviando audio al motor local (Demucs)",
  });

  const response = await fetch("/api/separate", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `El motor local fallo (${response.status})`);
    error.status = response.status;
    throw error;
  }

  options.onProgress?.({
    phase: "processing",
    progress: 70,
    label: "Stems separados en tu equipo, preparando reproduccion",
  });

  const data = await response.json();
  const stems = data?.stems || {};

  if (!Object.keys(stems).length) {
    throw new Error("El motor local no devolvio ningun stem.");
  }

  options.onProgress?.({ phase: "done", progress: 100, label: "Stems locales listos" });
  return stems;
}

export { STEMS_4, STEMS_6 };

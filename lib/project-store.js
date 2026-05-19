// Lightweight IndexedDB-backed store for StemsGroove projects.
// One object store keyed by the audio fingerprint so reloading the same
// file recovers the demixed stems + sequencer state without re-running
// the (slow) source-separation step.

const DB_NAME = "stemsgroove";
const STORE = "projects";
const VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no disponible en este entorno."));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "fingerprint" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("No se pudo abrir IndexedDB."));
  });
  return dbPromise;
}

export async function computeFingerprint(file) {
  if (!file) return null;
  const buf = await file.arrayBuffer();
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Lo-fi fallback: combine size, name and a tiny prefix hash. Good enough
    // to disambiguate as a key, not crypto-secure.
    const slice = new Uint8Array(buf.slice(0, 4096));
    let acc = 0x811c9dc5 >>> 0;
    for (let i = 0; i < slice.length; i += 1) {
      acc ^= slice[i];
      acc = (acc * 0x01000193) >>> 0;
    }
    return `f-${file.size}-${acc.toString(16)}-${file.name.length}`;
  }
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hash);
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function saveProject(project) {
  if (!project?.fingerprint) {
    throw new Error("Falta el fingerprint del proyecto.");
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...project, savedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("No se pudo guardar el proyecto."));
    tx.onabort = () => reject(tx.error || new Error("Guardado abortado."));
  });
}

export async function loadProject(fingerprint) {
  if (!fingerprint) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(fingerprint);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("No se pudo leer el proyecto."));
  });
}

export async function deleteProject(fingerprint) {
  if (!fingerprint) return false;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(fingerprint);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("No se pudo borrar el proyecto."));
  });
}

export async function listProjects() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("No se pudo listar."));
  });
}

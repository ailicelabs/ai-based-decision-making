// Costanti e tipi condivisi tra client e server per il caricamento file.
// Modulo "puro" (nessun import server-only): importabile anche dal client.

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_DOC_CHARS = 12000; // testo estratto da un documento (troncato)

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const DOC_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
];

export type Attachment =
  | { type: "image"; name: string; dataUrl: string }
  | { type: "document"; name: string; text: string };

// Classifica un file per MIME, con fallback sull'estensione (alcuni browser
// riportano un MIME vuoto o anomalo, es. per i CSV).
export function classifyFile(name: string, type: string): "image" | "document" | null {
  if (IMAGE_TYPES.includes(type)) return "image";
  if (DOC_TYPES.includes(type)) return "document";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["pdf", "txt", "csv", "md", "markdown"].includes(ext)) return "document";
  return null;
}

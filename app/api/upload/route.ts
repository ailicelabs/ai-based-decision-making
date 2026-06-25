import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { MAX_FILE_BYTES, MAX_DOC_CHARS, classifyFile } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 30;

// Riceve un documento (PDF/TXT/CSV/MD), ne estrae il testo e lo restituisce.
// Le immagini NON passano da qui: il client le invia come data URL nella chat.
export async function POST(req: Request) {
  const store = await cookies();
  if (!verifySession(store.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    // body non multipart
  }
  if (!file) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  if (classifyFile(file.name, file.type) !== "document") {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  let text = "";
  try {
    if (isPdf) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(data);
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } else {
      text = await file.text();
    }
  } catch (err) {
    console.error("extract error:", err);
    return NextResponse.json({ error: "extract_failed" }, { status: 422 });
  }

  // Rimuove i byte nulli (Postgres non li accetta nei campi text) e tronca.
  const NUL = String.fromCharCode(0);
  text = text.split(NUL).join("").trim().slice(0, MAX_DOC_CHARS);
  if (!text) return NextResponse.json({ error: "empty" }, { status: 422 });

  return NextResponse.json({ type: "document", name: file.name, text });
}

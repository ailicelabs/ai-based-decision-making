import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { setEventLabel, StorageUnavailableError } from "@/lib/db";

export const runtime = "nodejs";

// Etichetta dell'evento in corso (es. "STAT-2026-12-03"): da impostare prima
// di ogni evento. Viene registrata su messaggi, voti e consensi.
// Body: { label: string } — vuota = nessuna etichetta.
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  let label: unknown;
  try {
    label = (await req.json())?.label;
  } catch {
    // body non valido
  }
  if (typeof label !== "string") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const clean = label.trim();
  if (clean.length > 60 || !/^[A-Za-z0-9 _.\-]*$/.test(clean)) {
    return NextResponse.json({ ok: false, error: "invalid_label" }, { status: 400 });
  }
  try {
    await setEventLabel(clean);
    return NextResponse.json({ ok: true, label: clean });
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
    }
    console.error("POST /api/admin/event failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

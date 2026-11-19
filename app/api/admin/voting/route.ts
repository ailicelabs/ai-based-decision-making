import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { setVotingOpen, StorageUnavailableError } from "@/lib/db";

export const runtime = "nodejs";

// Apre o chiude il voto per tutte le squadre. Body: { open: boolean }.
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  let open: unknown;
  try {
    open = (await req.json())?.open;
  } catch {
    // body non valido
  }
  if (typeof open !== "boolean") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    await setVotingOpen(open);
    return NextResponse.json({ ok: true, open });
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
    }
    console.error("POST /api/admin/voting failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

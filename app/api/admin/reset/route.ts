import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { isMedTeam } from "@/lib/conditions";
import { deleteVotes, StorageUnavailableError } from "@/lib/db";

export const runtime = "nodejs";

// Azzera i voti. Body: {} = tutte le squadre; { team: "T3" } = una squadra.
// Irreversibile: la conferma la chiede l'interfaccia admin.
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  let team: unknown = undefined;
  try {
    team = (await req.json())?.team;
  } catch {
    // body vuoto = tutte le squadre
  }
  if (team !== undefined && team !== null && !isMedTeam(team)) {
    return NextResponse.json({ ok: false, error: "bad_team" }, { status: 400 });
  }
  try {
    const deleted = await deleteVotes(typeof team === "string" ? team : null);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
    }
    console.error("POST /api/admin/reset failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { MED_GROUPS } from "@/lib/conditions";
import { clearScenarioData, countScenarioData, setVotingOpen, StorageUnavailableError } from "@/lib/db";

export const runtime = "nodejs";

// Dati di prova dello scenario medicine (voti, consensi, chat).
// GET  -> quanti record verrebbero cancellati (per la conferma nell'admin).
// POST { confirm: "DELETE" } -> li cancella e riapre il voto.
const MED_CONDITIONS = MED_GROUPS.map((g) => g.condition as string);

function unavailable() {
  return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const counts = await countScenarioData(MED_CONDITIONS);
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return unavailable();
    console.error("GET /api/admin/clear-test-data failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  let confirm: unknown;
  try {
    confirm = (await req.json())?.confirm;
  } catch {
    // body non valido
  }
  if (confirm !== "DELETE") {
    return NextResponse.json({ ok: false, error: "confirmation_required" }, { status: 400 });
  }
  try {
    const deleted = await clearScenarioData(MED_CONDITIONS);
    await setVotingOpen(true);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return unavailable();
    console.error("POST /api/admin/clear-test-data failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

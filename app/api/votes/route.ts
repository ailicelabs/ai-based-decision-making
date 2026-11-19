import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { scenarioOf } from "@/lib/conditions";
import { verifySession, SESSION_COOKIE, type SessionData } from "@/lib/session";
import { getTeamVotes, isVotingOpen, saveVote, StorageUnavailableError } from "@/lib/db";
import { CHOICE_IDS, MAX_JUSTIFICATION, isOptionKey } from "@/lib/scenarios/medicine";

export const runtime = "nodejs";

// Scheda di voto della squadra (scenario medicine). La squadra viene SOLO dal
// cookie firmato: il client non può votare per un'altra squadra.
async function teamSession(): Promise<(SessionData & { team: string }) | null> {
  const store = await cookies();
  const session = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session || !session.team || scenarioOf(session.condition) !== "medicine") return null;
  return { ...session, team: session.team };
}

function unavailable() {
  return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
}

export async function GET() {
  const session = await teamSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const [open, votes] = await Promise.all([isVotingOpen(), getTeamVotes(session.team)]);
    return NextResponse.json(
      { ok: true, open, votes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof StorageUnavailableError) return unavailable();
    console.error("GET /api/votes failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Body: { choice, option } oppure { choice, justification }.
export async function PUT(req: Request) {
  const session = await teamSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 403 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // body non valido
  }

  const choice = body.choice;
  if (typeof choice !== "string" || !CHOICE_IDS.includes(choice)) {
    return NextResponse.json({ ok: false, error: "bad_choice" }, { status: 400 });
  }
  const option = body.option === undefined ? undefined : body.option;
  if (option !== undefined && !isOptionKey(option)) {
    return NextResponse.json({ ok: false, error: "bad_option" }, { status: 400 });
  }
  const justification =
    typeof body.justification === "string" ? body.justification.slice(0, MAX_JUSTIFICATION) : undefined;
  if (option === undefined && justification === undefined) {
    return NextResponse.json({ ok: false, error: "nothing_to_save" }, { status: 400 });
  }

  try {
    if (!(await isVotingOpen())) {
      return NextResponse.json({ ok: false, error: "voting_closed", open: false }, { status: 409 });
    }
    await saveVote({
      team: session.team,
      condition: session.condition,
      choice,
      sessionId: session.sid,
      option,
      justification,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return unavailable();
    console.error("PUT /api/votes failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

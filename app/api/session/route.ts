import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { type Condition, codeToAccess, languageOf, scenarioOf } from "@/lib/conditions";
import { signSession, verifySession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// Scenario, lingua e presenza del pannello di voto servono all'interfaccia.
// NON rivelano la condizione: lo scenario il partecipante lo conosce comunque
// dal compito che svolge; gruppo (il bias) e squadra restano solo lato server.
function publicInfo(condition: Condition, team: string | null | undefined) {
  const scenario = scenarioOf(condition);
  return { scenario, lang: languageOf(scenario), panel: scenario === "medicine" && Boolean(team) };
}

// Verifica se esiste già una sessione valida (per non rimostrare il gate dopo
// un refresh).
export async function GET() {
  const store = await cookies();
  const session = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, ...publicInfo(session.condition, session.team) });
}

// Valida il codice -> condizione (+ squadra) -> imposta il cookie di sessione firmato.
export async function POST(req: Request) {
  let code = "";
  try {
    const body = await req.json();
    code = String(body?.code ?? "");
  } catch {
    // body assente o non JSON
  }

  const access = codeToAccess(code);
  if (!access) {
    return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 401 });
  }

  const token = signSession({
    sid: crypto.randomUUID(),
    condition: access.condition,
    team: access.team,
    iat: Date.now(),
  });
  const res = NextResponse.json({ ok: true, ...publicInfo(access.condition, access.team) });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 ore
  });
  return res;
}

// Logout: cancella il cookie di sessione (torna al gate).
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

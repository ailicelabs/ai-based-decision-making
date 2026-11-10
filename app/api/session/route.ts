import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { codeToCondition, languageOf, scenarioOf } from "@/lib/conditions";
import { signSession, verifySession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

// Verifica se esiste già una sessione valida (per non rimostrare il gate dopo
// un refresh). NON rivela la condizione: la lingua deriva dallo scenario, che
// il partecipante conosce comunque, mai dal gruppo.
export async function GET() {
  const store = await cookies();
  const session = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, lang: languageOf(scenarioOf(session.condition)) });
}

// Valida il codice -> condizione -> imposta il cookie di sessione firmato.
export async function POST(req: Request) {
  let code = "";
  try {
    const body = await req.json();
    code = String(body?.code ?? "");
  } catch {
    // body assente o non JSON
  }

  const condition = codeToCondition(code);
  if (!condition) {
    return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 401 });
  }

  const token = signSession({ sid: crypto.randomUUID(), condition, iat: Date.now() });
  const res = NextResponse.json({ ok: true, lang: languageOf(scenarioOf(condition)) });
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

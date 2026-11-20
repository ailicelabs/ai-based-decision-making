import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { scenarioOf } from "@/lib/conditions";
import { loadConsentText } from "@/lib/consent";
import { recordConsent } from "@/lib/db";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "@/lib/session";

export const runtime = "nodejs";

// Testo di consenso dello scenario della sessione (con versione).
export async function GET() {
  const store = await cookies();
  const session = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const text = loadConsentText(scenarioOf(session.condition));
  if (!text) return NextResponse.json({ ok: false, error: "consent_text_missing" }, { status: 500 });
  return NextResponse.json(
    { ok: true, markdown: text.markdown, version: text.versionLabel },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Registra la scelta. Body: { agree: boolean, adult?: boolean }.
// Per accettare serve anche la conferma della maggiore età.
export async function POST(req: Request) {
  const store = await cookies();
  const session = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // body non valido
  }
  if (typeof body.agree !== "boolean") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const agree = body.agree;
  if (agree && body.adult !== true) {
    return NextResponse.json({ ok: false, error: "adult_required" }, { status: 400 });
  }

  const text = loadConsentText(scenarioOf(session.condition));
  if (!text) return NextResponse.json({ ok: false, error: "consent_text_missing" }, { status: 500 });

  try {
    await recordConsent({
      sessionId: session.sid,
      condition: session.condition,
      team: session.team ?? null,
      consent: agree,
      versionLabel: text.versionLabel,
      versionHash: text.versionHash,
    });
  } catch (err) {
    // Senza registrazione del consenso non si attiva il salvataggio delle chat.
    console.error("recordConsent failed:", err);
    return NextResponse.json({ ok: false, error: "storage_error" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, consent: agree });
  res.cookies.set(SESSION_COOKIE, signSession({ ...session, consent: agree }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

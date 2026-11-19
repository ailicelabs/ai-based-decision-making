import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, adminCodeMatches, signAdmin } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: await isAdmin() });
}

// Login admin con ADMIN_CODE (variabile d'ambiente). Senza ADMIN_CODE l'area
// admin resta chiusa.
export async function POST(req: Request) {
  let code = "";
  try {
    const body = await req.json();
    code = String(body?.code ?? "");
  } catch {
    // body non valido
  }
  if (!adminCodeMatches(code)) {
    return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, signAdmin(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

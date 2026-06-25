import crypto from "node:crypto";
import type { Condition } from "./conditions";

export type SessionData = {
  sid: string;
  condition: Condition;
  iat: number;
};

export const SESSION_COOKIE = "adm_session";

const SECRET = process.env.SESSION_SECRET || "dev-insecure-secret-change-me";

// Firma un payload con HMAC-SHA256 -> "<base64url-payload>.<base64url-mac>".
// Il client non può leggere né manomettere la condizione.
export function signSession(data: SessionData): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifySession(token: string | undefined | null): SessionData | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;

  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionData;
  } catch {
    return null;
  }
}

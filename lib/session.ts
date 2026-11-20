import crypto from "node:crypto";
import { type Condition, isCondition, isMedTeam } from "./conditions";

export type SessionData = {
  sid: string;
  condition: Condition;
  // Squadra (solo scenario medicine). Assente nelle sessioni meteo.
  team?: string | null;
  // Consenso alla ricerca: true = accettato, false = rifiutato,
  // null/assente = non ancora chiesto (la chat resta bloccata finché non risponde).
  consent?: boolean | null;
  iat: number;
};

export const SESSION_COOKIE = "adm_session";
export const ADMIN_COOKIE = "adm_admin";

const SECRET = process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_AGE = 60 * 60 * 8; // 8 ore

// Firma un payload con HMAC-SHA256 -> "<base64url-payload>.<base64url-mac>".
// Il client non può leggere né manomettere il contenuto.
function sign(data: object): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verify(token: string | undefined | null): Record<string, unknown> | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;

  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function signSession(data: SessionData): string {
  return sign(data);
}

export function verifySession(token: string | undefined | null): SessionData | null {
  const d = verify(token);
  if (!d || typeof d.sid !== "string" || !isCondition(d.condition)) return null;
  return {
    sid: d.sid,
    condition: d.condition,
    team: isMedTeam(d.team) ? d.team : null,
    consent: typeof d.consent === "boolean" ? d.consent : null,
    iat: typeof d.iat === "number" ? d.iat : 0,
  };
}

// --- Area admin: cookie separato, payload distinto da quello degli studenti ---

export function signAdmin(): string {
  return sign({ role: "admin", iat: Date.now() });
}

export function verifyAdmin(token: string | undefined | null): boolean {
  const d = verify(token);
  return Boolean(
    d && d.role === "admin" && typeof d.iat === "number" && Date.now() - d.iat < ADMIN_TTL_MS,
  );
}

export function adminCodeMatches(input: string): boolean {
  const configured = process.env.ADMIN_CODE?.trim();
  if (!configured) return false;
  const a = crypto.createHash("sha256").update(input.trim()).digest();
  const b = crypto.createHash("sha256").update(configured).digest();
  return crypto.timingSafeEqual(a, b);
}

export const ADMIN_COOKIE_MAX_AGE = ADMIN_TTL_MS / 1000;

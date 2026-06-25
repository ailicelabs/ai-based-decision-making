import { neon } from "@neondatabase/serverless";
import type { Condition } from "./conditions";

// Connessione Postgres. L'integrazione Neon su Vercel imposta DATABASE_URL.
// (POSTGRES_URL come fallback per compatibilità.) Se assente, il log è
// disattivato, così l'app gira anche senza database.
function connectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

let schemaReady: Promise<unknown> | null = null;

export async function logMessage(
  sessionId: string,
  condition: Condition,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const cs = connectionString();
  if (!cs) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[log:${condition}] ${role}: ${content.slice(0, 80)}`);
    }
    return;
  }

  try {
    const sql = neon(cs);
    if (!schemaReady) {
      schemaReady = sql`
        CREATE TABLE IF NOT EXISTS messages (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          condition TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
    }
    await schemaReady;
    await sql`
      INSERT INTO messages (session_id, condition, role, content)
      VALUES (${sessionId}, ${condition}, ${role}, ${content})
    `;
  } catch (err) {
    // Il log non deve mai rompere la risposta all'utente.
    console.error("logMessage failed:", err);
  }
}

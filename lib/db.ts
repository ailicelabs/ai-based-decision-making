import { neon } from "@neondatabase/serverless";
import type { Condition } from "./conditions";
import type { OptionKey, TeamVotes } from "./scenarios/medicine";

// Connessione Postgres. L'integrazione Neon su Vercel imposta DATABASE_URL.
// (POSTGRES_URL come fallback per compatibilità.) Se assente:
//  - il log dei messaggi è disattivato;
//  - i voti usano un archivio in memoria, SOLO in sviluppo (in produzione
//    senza database il voto è disattivato: le funzioni serverless non
//    condividono la memoria).
function connectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

type Sql = ReturnType<typeof neon<false, false>>;

let schemaReady: Promise<void> | null = null;

async function getSql(): Promise<Sql | null> {
  const cs = connectionString();
  if (!cs) return null;
  const sql = neon(cs);
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS messages (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          condition TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS team TEXT`;
      await sql`
        CREATE TABLE IF NOT EXISTS votes (
          team TEXT NOT NULL,
          condition TEXT NOT NULL,
          choice TEXT NOT NULL,
          option TEXT,
          justification TEXT NOT NULL DEFAULT '',
          updated_by TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (team, choice)
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`;
    })().catch((err) => {
      schemaReady = null; // riprova alla prossima chiamata
      throw err;
    });
  }
  await schemaReady;
  return sql;
}

// --------------------------------------------------------------------------
//  Log delle conversazioni
// --------------------------------------------------------------------------

export async function logMessage(
  sessionId: string,
  condition: Condition,
  team: string | null,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  try {
    const sql = await getSql();
    if (!sql) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[log:${condition}${team ? `/${team}` : ""}] ${role}: ${content.slice(0, 80)}`);
      }
      return;
    }
    await sql`
      INSERT INTO messages (session_id, condition, team, role, content)
      VALUES (${sessionId}, ${condition}, ${team}, ${role}, ${content})
    `;
  } catch (err) {
    // Il log non deve mai rompere la risposta all'utente.
    console.error("logMessage failed:", err);
  }
}

// --------------------------------------------------------------------------
//  Voti (scenario medicine): una scheda per squadra, una riga per scelta.
//  Aggiornamenti parziali (solo opzione o solo giustificazione) così due
//  dispositivi della stessa squadra non si sovrascrivono a vicenda.
// --------------------------------------------------------------------------

export type VoteRow = {
  team: string;
  condition: string;
  choice: string;
  option: OptionKey | null;
  justification: string;
  updated_at: string;
};

type MemStore = { votes: Map<string, VoteRow>; state: Map<string, string> };

function mem(): MemStore | null {
  if (process.env.NODE_ENV === "production") return null;
  const g = globalThis as unknown as { __admMem?: MemStore };
  if (!g.__admMem) g.__admMem = { votes: new Map(), state: new Map() };
  return g.__admMem;
}

export class StorageUnavailableError extends Error {}

export async function getTeamVotes(team: string): Promise<TeamVotes> {
  const rows = (await getAllVotes()).filter((r) => r.team === team);
  const out: TeamVotes = {};
  for (const r of rows) out[r.choice] = { option: r.option, justification: r.justification };
  return out;
}

export async function getAllVotes(): Promise<VoteRow[]> {
  const sql = await getSql();
  if (sql) {
    const rows = (await sql`
      SELECT team, condition, choice, option, justification, updated_at
      FROM votes ORDER BY team, choice
    `) as Record<string, unknown>[];
    return rows.map((r) => ({
      team: String(r.team),
      condition: String(r.condition),
      choice: String(r.choice),
      option: (r.option as OptionKey | null) ?? null,
      justification: String(r.justification ?? ""),
      updated_at: new Date(r.updated_at as string).toISOString(),
    }));
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  return Array.from(m.votes.values());
}

export async function saveVote(params: {
  team: string;
  condition: Condition;
  choice: string;
  sessionId: string;
  option?: OptionKey;
  justification?: string;
}): Promise<void> {
  const { team, condition, choice, sessionId, option, justification } = params;
  const sql = await getSql();
  if (sql) {
    if (option !== undefined) {
      await sql`
        INSERT INTO votes (team, condition, choice, option, updated_by)
        VALUES (${team}, ${condition}, ${choice}, ${option}, ${sessionId})
        ON CONFLICT (team, choice) DO UPDATE
        SET option = EXCLUDED.option, condition = EXCLUDED.condition,
            updated_by = EXCLUDED.updated_by, updated_at = now()
      `;
    }
    if (justification !== undefined) {
      await sql`
        INSERT INTO votes (team, condition, choice, justification, updated_by)
        VALUES (${team}, ${condition}, ${choice}, ${justification}, ${sessionId})
        ON CONFLICT (team, choice) DO UPDATE
        SET justification = EXCLUDED.justification, condition = EXCLUDED.condition,
            updated_by = EXCLUDED.updated_by, updated_at = now()
      `;
    }
    return;
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  const key = `${team}|${choice}`;
  const prev = m.votes.get(key);
  m.votes.set(key, {
    team,
    condition,
    choice,
    option: option !== undefined ? option : (prev?.option ?? null),
    justification: justification !== undefined ? justification : (prev?.justification ?? ""),
    updated_at: new Date().toISOString(),
  });
}

// --------------------------------------------------------------------------
//  Stato del voto (aperto/chiuso), deciso dall'area admin. Default: aperto.
// --------------------------------------------------------------------------

const VOTING_KEY = "voting_open";

export async function isVotingOpen(): Promise<boolean> {
  const sql = await getSql();
  if (sql) {
    const rows = (await sql`SELECT value FROM app_state WHERE key = ${VOTING_KEY}`) as {
      value: string;
    }[];
    return rows.length === 0 ? true : rows[0].value === "true";
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  return (m.state.get(VOTING_KEY) ?? "true") === "true";
}

export async function setVotingOpen(open: boolean): Promise<void> {
  const value = open ? "true" : "false";
  const sql = await getSql();
  if (sql) {
    await sql`
      INSERT INTO app_state (key, value) VALUES (${VOTING_KEY}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    return;
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  m.state.set(VOTING_KEY, value);
}

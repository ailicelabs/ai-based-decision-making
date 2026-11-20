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
        CREATE TABLE IF NOT EXISTS consents (
          session_id TEXT PRIMARY KEY,
          condition TEXT NOT NULL,
          team TEXT,
          consent BOOLEAN NOT NULL,
          version_label TEXT NOT NULL,
          version_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
        // In locale le chat restano in memoria, così si possono provare gli export.
        mem()?.messages.push({
          session_id: sessionId,
          condition,
          team,
          role,
          content,
          created_at: new Date().toISOString(),
        });
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

type ConsentRow = {
  session_id: string;
  condition: string;
  team: string | null;
  consent: boolean;
  version_label: string;
  version_hash: string;
  created_at: string;
};

export type MessageRow = {
  session_id: string;
  condition: string;
  team: string | null;
  role: string;
  content: string;
  created_at: string;
};

type MemStore = {
  votes: Map<string, VoteRow>;
  state: Map<string, string>;
  consents: Map<string, ConsentRow>;
  messages: MessageRow[];
};

function mem(): MemStore | null {
  if (process.env.NODE_ENV === "production") return null;
  const g = globalThis as unknown as { __admMem?: MemStore };
  if (!g.__admMem) g.__admMem = { votes: new Map(), state: new Map(), consents: new Map(), messages: [] };
  if (!g.__admMem.consents) g.__admMem.consents = new Map();
  if (!g.__admMem.messages) g.__admMem.messages = [];
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

// Cancella definitivamente i voti: di una squadra, oppure di tutte (team null).
// Restituisce quante righe (squadra × scelta) sono state eliminate.
export async function deleteVotes(team: string | null): Promise<number> {
  const sql = await getSql();
  if (sql) {
    const rows = (
      team === null
        ? await sql`DELETE FROM votes RETURNING team`
        : await sql`DELETE FROM votes WHERE team = ${team} RETURNING team`
    ) as unknown[];
    return rows.length;
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  let n = 0;
  for (const [key, row] of Array.from(m.votes.entries())) {
    if (team === null || row.team === team) {
      m.votes.delete(key);
      n += 1;
    }
  }
  return n;
}

// --------------------------------------------------------------------------
//  Consenso alla ricerca: una riga per sessione (= partecipante), con la
//  versione e l'impronta del testo mostrato.
// --------------------------------------------------------------------------

export async function recordConsent(params: {
  sessionId: string;
  condition: Condition;
  team: string | null;
  consent: boolean;
  versionLabel: string;
  versionHash: string;
}): Promise<void> {
  const { sessionId, condition, team, consent, versionLabel, versionHash } = params;
  const sql = await getSql();
  if (sql) {
    await sql`
      INSERT INTO consents (session_id, condition, team, consent, version_label, version_hash)
      VALUES (${sessionId}, ${condition}, ${team}, ${consent}, ${versionLabel}, ${versionHash})
      ON CONFLICT (session_id) DO UPDATE
      SET consent = EXCLUDED.consent, version_label = EXCLUDED.version_label,
          version_hash = EXCLUDED.version_hash, created_at = now()
    `;
    return;
  }
  const m = mem();
  if (!m) {
    // Produzione senza database: niente da registrare (e nessun log delle chat).
    return;
  }
  m.consents.set(sessionId, {
    session_id: sessionId,
    condition,
    team,
    consent,
    version_label: versionLabel,
    version_hash: versionHash,
    created_at: new Date().toISOString(),
  });
}

// Conteggio dei consensi per un insieme di condizioni (area admin).
export async function consentCounts(conditions: string[]): Promise<{ agreed: number; declined: number }> {
  const sql = await getSql();
  if (sql) {
    const rows = (await sql`
      SELECT consent, COUNT(*)::int AS n FROM consents
      WHERE condition = ANY(${conditions}) GROUP BY consent
    `) as { consent: boolean; n: number }[];
    return {
      agreed: rows.find((r) => r.consent)?.n ?? 0,
      declined: rows.find((r) => !r.consent)?.n ?? 0,
    };
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  const mine = Array.from(m.consents.values()).filter((r) => conditions.includes(r.condition));
  return {
    agreed: mine.filter((r) => r.consent).length,
    declined: mine.filter((r) => !r.consent).length,
  };
}

// --------------------------------------------------------------------------
//  Export per l'analisi (area admin): chat dei soli partecipanti con consenso
//  e registro completo dei consensi.
// --------------------------------------------------------------------------

export type ConsentedMessage = MessageRow & { consent_version: string; consent_hash: string };

export async function getConsentedMessages(): Promise<ConsentedMessage[]> {
  const sql = await getSql();
  if (sql) {
    const rows = (await sql`
      SELECT m.session_id, m.condition, m.team, m.role, m.content, m.created_at,
             c.version_label, c.version_hash
      FROM messages m
      JOIN consents c ON c.session_id = m.session_id AND c.consent
      ORDER BY m.session_id, m.created_at, m.id
    `) as Record<string, unknown>[];
    return rows.map((r) => ({
      session_id: String(r.session_id),
      condition: String(r.condition),
      team: (r.team as string | null) ?? null,
      role: String(r.role),
      content: String(r.content),
      created_at: new Date(r.created_at as string).toISOString(),
      consent_version: String(r.version_label),
      consent_hash: String(r.version_hash),
    }));
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  return m.messages
    .filter((x) => m.consents.get(x.session_id)?.consent === true)
    .map((x) => {
      const c = m.consents.get(x.session_id)!;
      return { ...x, consent_version: c.version_label, consent_hash: c.version_hash };
    })
    .sort((a, b) => a.session_id.localeCompare(b.session_id) || a.created_at.localeCompare(b.created_at));
}

export type ConsentRecord = {
  session_id: string;
  condition: string;
  team: string | null;
  consent: boolean;
  version_label: string;
  version_hash: string;
  created_at: string;
};

export async function getAllConsents(): Promise<ConsentRecord[]> {
  const sql = await getSql();
  if (sql) {
    const rows = (await sql`
      SELECT session_id, condition, team, consent, version_label, version_hash, created_at
      FROM consents ORDER BY created_at
    `) as Record<string, unknown>[];
    return rows.map((r) => ({
      session_id: String(r.session_id),
      condition: String(r.condition),
      team: (r.team as string | null) ?? null,
      consent: Boolean(r.consent),
      version_label: String(r.version_label),
      version_hash: String(r.version_hash),
      created_at: new Date(r.created_at as string).toISOString(),
    }));
  }
  const m = mem();
  if (!m) throw new StorageUnavailableError("No database configured");
  return Array.from(m.consents.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// --------------------------------------------------------------------------
//  Dati di prova: conteggio e cancellazione di voti, consensi e chat per un
//  insieme di condizioni (lo scenario medicine). Gli altri scenari non vengono
//  toccati. Irreversibile: la conferma la chiede l'area admin.
// --------------------------------------------------------------------------

export type ScenarioDataCounts = { votes: number; consents: number; messages: number };

export async function countScenarioData(conditions: string[]): Promise<ScenarioDataCounts> {
  const sql = await getSql();
  if (sql) {
    const v = (await sql`SELECT COUNT(*)::int AS n FROM votes WHERE condition = ANY(${conditions})`) as { n: number }[];
    const c = (await sql`SELECT COUNT(*)::int AS n FROM consents WHERE condition = ANY(${conditions})`) as { n: number }[];
    const m = (await sql`SELECT COUNT(*)::int AS n FROM messages WHERE condition = ANY(${conditions})`) as { n: number }[];
    return { votes: v[0]?.n ?? 0, consents: c[0]?.n ?? 0, messages: m[0]?.n ?? 0 };
  }
  const mm = mem();
  if (!mm) throw new StorageUnavailableError("No database configured");
  return {
    votes: Array.from(mm.votes.values()).filter((r) => conditions.includes(r.condition)).length,
    consents: Array.from(mm.consents.values()).filter((r) => conditions.includes(r.condition)).length,
    messages: mm.messages.filter((r) => conditions.includes(r.condition)).length,
  };
}

export async function clearScenarioData(conditions: string[]): Promise<ScenarioDataCounts> {
  const sql = await getSql();
  if (sql) {
    const v = (await sql`DELETE FROM votes WHERE condition = ANY(${conditions}) RETURNING 1`) as unknown[];
    const c = (await sql`DELETE FROM consents WHERE condition = ANY(${conditions}) RETURNING 1`) as unknown[];
    const m = (await sql`DELETE FROM messages WHERE condition = ANY(${conditions}) RETURNING 1`) as unknown[];
    return { votes: v.length, consents: c.length, messages: m.length };
  }
  const mm = mem();
  if (!mm) throw new StorageUnavailableError("No database configured");
  const counts = await countScenarioData(conditions);
  for (const [k, r] of Array.from(mm.votes.entries())) if (conditions.includes(r.condition)) mm.votes.delete(k);
  for (const [k, r] of Array.from(mm.consents.entries())) if (conditions.includes(r.condition)) mm.consents.delete(k);
  mm.messages = mm.messages.filter((r) => !conditions.includes(r.condition));
  return counts;
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

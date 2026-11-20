import { isAdmin } from "@/lib/admin";
import { groupLetterOf, orientationOf, scenarioOf, teamLabel, type Condition } from "@/lib/conditions";
import { csvResponse, toCsv, today } from "@/lib/csv";
import { getConsentedMessages, StorageUnavailableError } from "@/lib/db";

export const runtime = "nodejs";

// Export CSV delle chat: una riga per messaggio, SOLO dei partecipanti che
// hanno dato il consenso alla ricerca (tutti gli scenari). "participant" è
// l'identificativo anonimo della sessione: raggruppa i messaggi di una persona.
export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const rows = await getConsentedMessages();
    const header = [
      "created_at",
      "event",
      "scenario",
      "group",
      "orientation",
      "team",
      "participant",
      "role",
      "content",
      "consent_version",
      "model",
      "temperature",
      "app_version",
      "prompt_hash",
    ];
    const out = rows.map((r) => [
      r.created_at,
      r.event_label,
      scenarioOf(r.condition as Condition),
      groupLetterOf(r.condition),
      orientationOf(r.condition),
      teamLabel(r.team),
      r.session_id,
      r.role === "user" ? "participant" : "assistant",
      r.content,
      r.consent_version,
      r.model,
      r.temperature,
      r.app_version,
      r.prompt_hash,
    ]);
    return csvResponse(toCsv(header, out), `chats-${today()}.csv`);
  } catch (err) {
    if (err instanceof StorageUnavailableError) return new Response("Storage unavailable", { status: 503 });
    console.error("GET /api/admin/export/chats failed:", err);
    return new Response("Error", { status: 500 });
  }
}

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
      "scenario",
      "group",
      "orientation",
      "team",
      "participant",
      "role",
      "content",
      "consent_version",
    ];
    const out = rows.map((r) => [
      r.created_at,
      scenarioOf(r.condition as Condition),
      groupLetterOf(r.condition),
      orientationOf(r.condition),
      teamLabel(r.team),
      r.session_id,
      r.role === "user" ? "participant" : "assistant",
      r.content,
      r.consent_version,
    ]);
    return csvResponse(toCsv(header, out), `chats-${today()}.csv`);
  } catch (err) {
    if (err instanceof StorageUnavailableError) return new Response("Storage unavailable", { status: 503 });
    console.error("GET /api/admin/export/chats failed:", err);
    return new Response("Error", { status: 500 });
  }
}

import { isAdmin } from "@/lib/admin";
import { groupLetterOf, orientationOf, teamLabel } from "@/lib/conditions";
import { csvResponse, toCsv, today } from "@/lib/csv";
import { getVoteEvents, StorageUnavailableError } from "@/lib/db";
import { isOptionKey, optionScore } from "@/lib/scenarios/medicine";

export const runtime = "nodejs";

// Registro di OGNI modifica ai voti, in ordine di tempo: permette di vedere
// quando una squadra ha scelto o cambiato un'opzione e chi l'ha fatto
// ("participant" = id anonimo della sessione, lo stesso dell'export delle chat).
export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const events = await getVoteEvents();
    const header = [
      "created_at",
      "event",
      "team",
      "group",
      "orientation",
      "choice",
      "field",
      "value",
      "score",
      "participant",
    ];
    const out = events.map((e) => [
      e.created_at,
      e.event_label,
      teamLabel(e.team),
      groupLetterOf(e.condition),
      orientationOf(e.condition),
      e.choice,
      e.field,
      e.value,
      e.field === "option" && isOptionKey(e.value) ? optionScore(e.value) : null,
      e.session_id,
    ]);
    return csvResponse(toCsv(header, out), `vote-log-${today()}.csv`);
  } catch (err) {
    if (err instanceof StorageUnavailableError) return new Response("Storage unavailable", { status: 503 });
    console.error("GET /api/admin/export/vote-log failed:", err);
    return new Response("Error", { status: 500 });
  }
}

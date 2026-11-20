import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { MED_TEAMS, groupLetterOf, orientationOf, scenarioOf, teamLabel, type Condition } from "@/lib/conditions";
import { today } from "@/lib/csv";
import {
  getAllConsents,
  getAllVotes,
  getConsentedMessages,
  getEventLabel,
  getVoteEvents,
  StorageUnavailableError,
} from "@/lib/db";
import { CHOICES, OPTION_KEYS, isOptionKey, optionScore } from "@/lib/scenarios/medicine";
import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";

// Export JSON di tutti i dati per l'analisi (R, Python):
//  - teams: le risposte di ogni squadra (scenario medicine);
//  - participants: le conversazioni dei soli partecipanti con consenso;
//  - consents: il registro completo dei consensi (anche i rifiuti, senza chat).
export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const [votes, messages, consents, voteEvents, currentEvent] = await Promise.all([
      getAllVotes(),
      getConsentedMessages(),
      getAllConsents(),
      getVoteEvents(),
      getEventLabel(),
    ]);

    const teams = MED_TEAMS.map((t) => ({
      team: t.label,
      condition: t.condition,
      group: groupLetterOf(t.condition),
      orientation: orientationOf(t.condition),
      answers: CHOICES.map((c) => {
        const v = votes.find((x) => x.team === t.team && x.choice === c.id);
        return {
          choice: c.id,
          option: v?.option ?? null,
          score: v?.option ? optionScore(v.option) : null,
          justification: v?.justification ?? null,
          updated_at: v?.updated_at ?? null,
          updated_by: v?.updated_by ?? null,
          event: v?.event_label ?? null,
        };
      }),
    }));

    const byParticipant = new Map<string, typeof messages>();
    for (const m of messages) {
      const list = byParticipant.get(m.session_id) ?? [];
      list.push(m);
      byParticipant.set(m.session_id, list);
    }
    const consentBySession = new Map(consents.map((c) => [c.session_id, c]));
    const participants = Array.from(byParticipant.entries()).map(([sid, list]) => {
      const first = list[0];
      const c = consentBySession.get(sid);
      return {
        participant: sid,
        scenario: scenarioOf(first.condition as Condition),
        condition: first.condition,
        group: groupLetterOf(first.condition),
        orientation: orientationOf(first.condition),
        team: teamLabel(first.team),
        consent_version: first.consent_version,
        consent_hash: first.consent_hash,
        consented_at: c?.created_at ?? null,
        messages: list.map((m) => ({
          at: m.created_at,
          event: m.event_label,
          role: m.role === "user" ? "participant" : "assistant",
          content: m.content,
          model: m.model,
          temperature: m.temperature,
          app_version: m.app_version,
          prompt_hash: m.prompt_hash,
        })),
      };
    });

    const body = {
      exported_at: new Date().toISOString(),
      app_version: APP_VERSION,
      current_event: currentEvent,
      notes: {
        scoring: Object.fromEntries(OPTION_KEYS.map((k) => [k, optionScore(k)])),
        scoring_meaning: "A = lightest response ... D = strongest response",
        participants: "Only participants who gave research consent; one entry per anonymous session.",
        consents: "Every consent decision, including declines (no conversation data for declines).",
        vote_log: "Every change to a team answer, in time order; participant = the anonymous session that made it.",
        prompt_hash: "SHA-256 (first 16 hex) of the exact system prompt used for that reply.",
      },
      choices: CHOICES.map((c) => ({ id: c.id, label: c.label, question: c.question, options: c.options })),
      teams,
      participants,
      vote_log: voteEvents.map((e) => ({
        at: e.created_at,
        event: e.event_label,
        team: teamLabel(e.team),
        group: groupLetterOf(e.condition),
        choice: e.choice,
        field: e.field,
        value: e.value,
        score: e.field === "option" && isOptionKey(e.value) ? optionScore(e.value) : null,
        participant: e.session_id,
      })),
      consents: consents.map((c) => ({
        participant: c.session_id,
        scenario: scenarioOf(c.condition as Condition),
        condition: c.condition,
        group: groupLetterOf(c.condition),
        team: teamLabel(c.team),
        consent: c.consent,
        version: c.version_label,
        hash: c.version_hash,
        event: c.event_label,
        at: c.created_at,
      })),
    };

    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="study-export-${today()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
    }
    console.error("GET /api/admin/export/all failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

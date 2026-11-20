import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { MED_TEAMS, groupLetterOf, orientationOf, scenarioOf, teamLabel, type Condition } from "@/lib/conditions";
import { today } from "@/lib/csv";
import {
  getAllConsents,
  getAllVotes,
  getConsentedMessages,
  StorageUnavailableError,
} from "@/lib/db";
import { CHOICES, OPTION_KEYS, optionScore } from "@/lib/scenarios/medicine";

export const runtime = "nodejs";

// Export JSON di tutti i dati per l'analisi (R, Python):
//  - teams: le risposte di ogni squadra (scenario medicine);
//  - participants: le conversazioni dei soli partecipanti con consenso;
//  - consents: il registro completo dei consensi (anche i rifiuti, senza chat).
export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const [votes, messages, consents] = await Promise.all([
      getAllVotes(),
      getConsentedMessages(),
      getAllConsents(),
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
          role: m.role === "user" ? "participant" : "assistant",
          content: m.content,
        })),
      };
    });

    const body = {
      exported_at: new Date().toISOString(),
      notes: {
        scoring: Object.fromEntries(OPTION_KEYS.map((k) => [k, optionScore(k)])),
        scoring_meaning: "A = lightest response ... D = strongest response",
        participants: "Only participants who gave research consent; one entry per anonymous session.",
        consents: "Every consent decision, including declines (no conversation data for declines).",
      },
      choices: CHOICES.map((c) => ({ id: c.id, label: c.label, question: c.question, options: c.options })),
      teams,
      participants,
      consents: consents.map((c) => ({
        participant: c.session_id,
        scenario: scenarioOf(c.condition as Condition),
        condition: c.condition,
        group: groupLetterOf(c.condition),
        team: teamLabel(c.team),
        consent: c.consent,
        version: c.version_label,
        hash: c.version_hash,
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

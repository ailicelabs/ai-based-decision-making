import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { MED_GROUPS, MED_TEAMS, configuredTeams } from "@/lib/conditions";
import { getAllVotes, isVotingOpen, StorageUnavailableError } from "@/lib/db";
import type { TeamVotes } from "@/lib/scenarios/medicine";

export const runtime = "nodejs";

// Risultati per l'area admin. I nomi degli orientamenti escono SOLO da qui,
// dietro autenticazione: non sono nel bundle JavaScript pubblico.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const [open, rows] = await Promise.all([isVotingOpen(), getAllVotes()]);
    const configured = configuredTeams();
    const teams = MED_TEAMS.map((t) => {
      const mine = rows.filter((r) => r.team === t.team);
      const votes: TeamVotes = {};
      for (const r of mine) votes[r.choice] = { option: r.option, justification: r.justification };
      const lastUpdate = mine.reduce<string | null>(
        (acc, r) => (acc === null || r.updated_at > acc ? r.updated_at : acc),
        null,
      );
      return {
        team: t.team,
        label: t.label,
        group: t.condition,
        configured: configured.has(t.team),
        lastUpdate,
        votes,
      };
    });
    return NextResponse.json(
      {
        ok: true,
        open,
        groups: MED_GROUPS.map((g) => ({
          id: g.condition,
          index: g.index,
          orientation: g.orientation,
        })),
        teams,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return NextResponse.json({ ok: false, error: "storage_unavailable" }, { status: 503 });
    }
    console.error("GET /api/admin/results failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

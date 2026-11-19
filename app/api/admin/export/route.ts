import { isAdmin } from "@/lib/admin";
import { MED_GROUPS, MED_TEAMS } from "@/lib/conditions";
import { getAllVotes, StorageUnavailableError } from "@/lib/db";
import { CHOICES, optionScore } from "@/lib/scenarios/medicine";

export const runtime = "nodejs";

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export CSV: una riga per squadra × scelta (anche quelle senza voto).
export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const rows = await getAllVotes();
    const header = [
      "team",
      "group",
      "orientation",
      "choice",
      "choice_label",
      "option",
      "score",
      "justification",
      "updated_at",
    ];
    const lines = [header.join(",")];
    for (const t of MED_TEAMS) {
      const g = MED_GROUPS.find((x) => x.condition === t.condition);
      for (const c of CHOICES) {
        const r = rows.find((x) => x.team === t.team && x.choice === c.id);
        lines.push(
          [
            t.label,
            t.condition,
            g?.orientation ?? "",
            c.id,
            c.label,
            r?.option ?? null,
            r?.option ? optionScore(r.option) : null,
            r?.justification ?? null,
            r?.updated_at ?? null,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
    return new Response("﻿" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="outbreak-votes.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return new Response("Storage unavailable", { status: 503 });
    }
    console.error("GET /api/admin/export failed:", err);
    return new Response("Error", { status: 500 });
  }
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHOICES,
  OPTION_KEYS,
  optionScore,
  type OptionKey,
  type TeamVotes,
} from "@/lib/scenarios/medicine";

// =============================================================================
//  Area admin (non linkata): risultati del voto per squadra e per assistente,
//  apertura/chiusura del voto, rivelazione degli orientamenti, export CSV.
//  I nomi degli orientamenti arrivano SOLO da /api/admin/results (autenticato).
// =============================================================================

type Group = { id: string; index: number; orientation: string };
type Team = {
  team: string;
  label: string;
  group: string;
  configured: boolean;
  lastUpdate: string | null;
  votes: TeamVotes;
};
type Results = { open: boolean; groups: Group[]; teams: Team[] };

const REFRESH_MS = 5000;

// Scala ordinale A→D (un solo tono, chiaro→scuro), validata con --ordinal.
const RAMP: Record<OptionKey, { bg: string; fg: string }> = {
  A: { bg: "#86b6ef", fg: "#0b0b0b" },
  B: { bg: "#5598e7", fg: "#0b0b0b" },
  C: { bg: "#2a78d6", fg: "#ffffff" },
  D: { bg: "#1c5cab", fg: "#ffffff" },
};

const SHORT: Record<string, string> = {
  "1": "1 Alert",
  "2a": "2a Farm",
  "2b": "2b Market",
  "3": "3 Hospital",
  "4a": "4a Testing",
  "4b": "4b Comms",
};

function teamMean(t: Team): { mean: number | null; n: number } {
  const scores = CHOICES.map((c) => t.votes[c.id]?.option)
    .filter((o): o is OptionKey => Boolean(o))
    .map(optionScore);
  if (scores.length === 0) return { mean: null, n: 0 };
  return { mean: scores.reduce((a, b) => a + b, 0) / scores.length, n: scores.length };
}

function fmt(n: number): string {
  return n.toFixed(1);
}

// Posizione su una scala 1–4 in percentuale della larghezza del grafico.
function pos(score: number): string {
  return `${((score - 1) / 3) * 100}%`;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [data, setData] = useState<Results | null>(null);
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<{ team: string; choice: string } | null>(null);
  const [pinned, setPinned] = useState<{ team: string; choice: string } | null>(null);
  const [hoverTeam, setHoverTeam] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.title = "Results — AI-Based Decision Making";
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((d) => setAuthed(Boolean(d?.ok)))
      .catch(() => setAuthed(false));
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/results", { cache: "no-store" });
      if (r.status === 401) {
        setAuthed(false);
        return;
      }
      if (r.status === 503) {
        setLoadError("No database configured: votes cannot be stored or read.");
        return;
      }
      if (!r.ok) throw new Error();
      setData((await r.json()) as Results);
      setLoadError("");
      setUpdatedAt(new Date());
    } catch {
      setLoadError("Could not refresh the results. Retrying…");
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [authed, load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    try {
      const r = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (r.ok) {
        setCode("");
        setAuthed(true);
      } else {
        setAuthError("Invalid admin code.");
      }
    } catch {
      setAuthError("Network error, please try again.");
    }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => {});
    setAuthed(false);
    setData(null);
  }

  async function toggleVoting() {
    if (!data) return;
    const next = !data.open;
    if (!next && !window.confirm("Close voting for all teams? Their answers will be locked.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/voting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: next }),
      });
      if (r.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  // Azzera i voti di tutte le squadre (team assente) o di una squadra.
  async function resetVotes(team?: Team) {
    const question = team
      ? `Delete all of ${team.label}'s answers and justifications?\n\nThis cannot be undone. Export the CSV first if you need it.`
      : "Delete ALL teams' answers and justifications?\n\nThis cannot be undone. Export the CSV first if you need it.";
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(team ? { team: team.team } : {}),
      });
      const d = await r.json().catch(() => null);
      if (r.ok) {
        setPinned(null);
        setFocus(null);
        setNotice(
          `${team ? team.label : "All teams"}: ${d?.deleted ?? 0} answer${d?.deleted === 1 ? "" : "s"} deleted.`,
        );
        setTimeout(() => setNotice(""), 6000);
        await load();
      } else {
        setNotice("Reset failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const groupName = useCallback(
    (g: Group) => (reveal ? `Assistant ${g.index} · ${g.orientation}` : `Assistant ${g.index}`),
    [reveal],
  );

  const stats = useMemo(() => {
    if (!data) return null;
    const teamsVoted = data.teams.filter((t) => teamMean(t).n > 0).length;
    const recorded = data.teams.reduce(
      (acc, t) => acc + CHOICES.filter((c) => t.votes[c.id]?.option).length,
      0,
    );
    const byGroup = data.groups.map((g) => {
      const teams = data.teams.filter((t) => t.group === g.id);
      const means = teams.map((t) => ({ team: t, ...teamMean(t) }));
      const all = teams.flatMap((t) =>
        CHOICES.map((c) => t.votes[c.id]?.option)
          .filter((o): o is OptionKey => Boolean(o))
          .map(optionScore),
      );
      const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
      return { group: g, teams, means, mean, n: all.length };
    });
    return { teamsVoted, recorded, byGroup };
  }, [data]);

  if (authed === null) {
    return (
      <main className="center">
        <div className="muted">Loading…</div>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="center">
        <form className="gate" onSubmit={login}>
          <div className="gate-head">
            <h1 className="gate-title">Results</h1>
          </div>
          <div className="gate-form">
            <input
              className="gate-input admin-code"
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Admin code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {authError && (
              <div className="gate-error" role="alert">
                {authError}
              </div>
            )}
            <button className="btn gate-btn" type="submit" disabled={!code.trim()}>
              Enter
            </button>
          </div>
        </form>
      </main>
    );
  }

  const shown = pinned ?? focus;
  const shownTeam = shown && data?.teams.find((t) => t.team === shown.team);
  const shownChoice = shown && CHOICES.find((c) => c.id === shown.choice);
  const shownVote = shownTeam && shownChoice ? shownTeam.votes[shownChoice.id] : undefined;
  const shownGroup = shownTeam && data?.groups.find((g) => g.id === shownTeam.group);

  return (
    <main className="admin">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">Outbreak in Pavia — results</h1>
          <div className="admin-sub">
            {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · refreshes every 5 s` : "Loading…"}
          </div>
        </div>
        <div className="admin-actions">
          <button
            type="button"
            className={`admin-btn${reveal ? " on" : ""}`}
            aria-pressed={reveal}
            onClick={() => setReveal((r) => !r)}
          >
            {reveal ? "Hide orientations" : "Reveal orientations"}
          </button>
          <button type="button" className="admin-btn" onClick={toggleVoting} disabled={!data || busy}>
            {data?.open ? "Close voting" : "Reopen voting"}
          </button>
          <a className="admin-btn" href="/api/admin/export">
            Export CSV
          </a>
          <button type="button" className="admin-btn danger" onClick={() => resetVotes()} disabled={!data || busy}>
            Reset all votes
          </button>
          <button type="button" className="admin-btn ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      {loadError && <div className="admin-error">{loadError}</div>}
      {notice && (
        <div className="admin-notice" role="status">
          {notice}
        </div>
      )}

      {data && stats && (
        <>
          <section className="kpis" aria-label="Summary">
            <div className="kpi">
              <div className="kpi-label">Voting</div>
              <div className="kpi-value">
                <span className={`dot ${data.open ? "open" : "closed"}`} aria-hidden="true" />
                {data.open ? "Open" : "Closed"}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Teams that voted</div>
              <div className="kpi-value">
                {stats.teamsVoted} / {data.teams.length}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Choices recorded</div>
              <div className="kpi-value">
                {stats.recorded} / {data.teams.length * CHOICES.length}
              </div>
            </div>
          </section>

          {/* --- Grafico 1: livello medio di risposta per assistente --- */}
          <section className="card" aria-labelledby="dots-title">
            <h2 id="dots-title" className="card-title">
              How strongly did each assistant&apos;s teams respond?
            </h2>
            <p className="card-sub">
              Each dot is one team&apos;s average across its choices (A = 1, lightest response … D = 4,
              strongest). The dark tick is the assistant&apos;s average over both teams.
            </p>
            <div className="dots">
              {stats.byGroup.map(({ group, means, mean, n }) => (
                <div key={group.id} className="dots-row">
                  <div className="dots-label">{groupName(group)}</div>
                  <div className="dots-plot">
                    {[1, 2, 3, 4].map((s) => (
                      <span key={s} className="dots-grid" style={{ left: pos(s) }} />
                    ))}
                    {mean !== null && (
                      <span
                        className="dots-mean"
                        style={{ left: pos(mean) }}
                        title={`${groupName(group)}: average ${fmt(mean)} over ${n} choices`}
                      />
                    )}
                    {means.map(({ team, mean: m, n: tn }, i) =>
                      m === null ? null : (
                        <span
                          key={team.team}
                          className={`dots-team${hoverTeam === team.team ? " hot" : ""}`}
                          style={{ left: pos(m), top: i === 0 ? "30%" : "70%" }}
                          tabIndex={0}
                          onMouseEnter={() => setHoverTeam(team.team)}
                          onMouseLeave={() => setHoverTeam(null)}
                          onFocus={() => setHoverTeam(team.team)}
                          onBlur={() => setHoverTeam(null)}
                          aria-label={`${team.label}: average ${fmt(m)} over ${tn} choices`}
                        >
                          <span
                            className={`dots-team-label${mean !== null && m < mean ? " left" : ""}`}
                          >
                            {team.label.replace("Team ", "T")}
                          </span>
                        </span>
                      ),
                    )}
                    {means.every((x) => x.mean === null) && <span className="dots-empty">No votes yet</span>}
                  </div>
                  <div className="dots-value">{mean === null ? "—" : fmt(mean)}</div>
                </div>
              ))}
              <div className="dots-row dots-axis" aria-hidden="true">
                <div className="dots-label" />
                <div className="dots-plot">
                  {OPTION_KEYS.map((k, i) => (
                    <span key={k} className="dots-tick" style={{ left: pos(i + 1) }}>
                      {k} · {i + 1}
                    </span>
                  ))}
                </div>
                <div className="dots-value" />
              </div>
            </div>
            <div className="readout" aria-live="polite">
              {(() => {
                const t = hoverTeam && data.teams.find((x) => x.team === hoverTeam);
                if (!t) return "Hover a dot for the team's details.";
                const { mean: m, n } = teamMean(t);
                return `${t.label}: average ${m === null ? "—" : fmt(m)} over ${n} of ${CHOICES.length} choices.`;
              })()}
            </div>
          </section>

          {/* --- Grafico 2: chi ha scelto cosa (squadre × scelte) --- */}
          <section className="card" aria-labelledby="grid-title">
            <h2 id="grid-title" className="card-title">
              What each team chose
            </h2>
            <div className="legend" aria-label="Legend">
              {OPTION_KEYS.map((k, i) => (
                <span key={k} className="legend-item">
                  <span className="legend-swatch" style={{ background: RAMP[k].bg }} />
                  {k}
                  {i === 0 ? " lightest" : i === 3 ? " strongest" : ""}
                </span>
              ))}
              <span className="legend-hint">Hover or click a cell to read the justification.</span>
            </div>
            <div className="grid-wrap">
              <table className="vgrid">
                <thead>
                  <tr>
                    <th scope="col" className="vgrid-team">
                      Team
                    </th>
                    {CHOICES.map((c) => (
                      <th key={c.id} scope="col" title={c.label}>
                        {SHORT[c.id] ?? c.label}
                      </th>
                    ))}
                    <th scope="col">Avg</th>
                    <th scope="col">
                      <span className="sr-only">Reset</span>
                    </th>
                  </tr>
                </thead>
                {data.groups.map((g) => (
                  <tbody key={g.id}>
                    <tr className="vgrid-group">
                      <th colSpan={CHOICES.length + 3} scope="colgroup">
                        {groupName(g)}
                      </th>
                    </tr>
                    {data.teams
                      .filter((t) => t.group === g.id)
                      .map((t) => {
                        const { mean: m } = teamMean(t);
                        return (
                          <tr key={t.team}>
                            <th scope="row" className="vgrid-team">
                              {t.label}
                              {!t.configured && <span className="vgrid-warn"> · no code set</span>}
                            </th>
                            {CHOICES.map((c) => {
                              const o = t.votes[c.id]?.option ?? null;
                              const sel =
                                (pinned?.team === t.team && pinned?.choice === c.id) ||
                                (!pinned && focus?.team === t.team && focus?.choice === c.id);
                              return (
                                <td key={c.id}>
                                  <button
                                    type="button"
                                    className={`cell${o ? "" : " empty"}${sel ? " sel" : ""}`}
                                    style={o ? { background: RAMP[o].bg, color: RAMP[o].fg } : undefined}
                                    onMouseEnter={() => setFocus({ team: t.team, choice: c.id })}
                                    onFocus={() => setFocus({ team: t.team, choice: c.id })}
                                    onClick={() =>
                                      setPinned((p) =>
                                        p?.team === t.team && p?.choice === c.id ? null : { team: t.team, choice: c.id },
                                      )
                                    }
                                    aria-label={`${t.label}, ${c.label}: ${o ?? "no vote"}`}
                                  >
                                    {o ?? "—"}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="vgrid-avg">{m === null ? "—" : fmt(m)}</td>
                            <td className="vgrid-reset">
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => resetVotes(t)}
                                disabled={busy || Object.keys(t.votes).length === 0}
                                aria-label={`Reset ${t.label}'s votes`}
                              >
                                Reset
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                ))}
              </table>
            </div>
            <div className="detail" aria-live="polite">
              {shownTeam && shownChoice && shownGroup ? (
                <>
                  <div className="detail-head">
                    {shownTeam.label} · {groupName(shownGroup)} · {shownChoice.label}
                    {pinned && (
                      <button type="button" className="link-btn detail-unpin" onClick={() => setPinned(null)}>
                        unpin
                      </button>
                    )}
                  </div>
                  {shownVote?.option ? (
                    <>
                      <div className="detail-option">
                        <strong>{shownVote.option}</strong> — {shownChoice.options[shownVote.option]}
                      </div>
                      <div className="detail-why">
                        {shownVote.justification.trim() ? `“${shownVote.justification.trim()}”` : "No justification written."}
                      </div>
                    </>
                  ) : (
                    <div className="detail-why">No option chosen yet.</div>
                  )}
                </>
              ) : (
                <span className="muted">Hover or click a cell to read the team&apos;s justification.</span>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

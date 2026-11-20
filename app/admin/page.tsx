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
type Results = {
  open: boolean;
  consents?: { agreed: number; declined: number };
  eventLabel?: string | null;
  groups: Group[];
  teams: Team[];
};

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
  const [eventDraft, setEventDraft] = useState<string | null>(null);

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

  // Etichetta dell'evento: salvata con ogni chat, voto e consenso.
  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();
    if (eventDraft === null) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: eventDraft }),
      });
      if (r.ok) {
        setEventDraft(null);
        await load();
      } else {
        setNotice("Invalid event label: use letters, numbers, spaces, dots, dashes (max 60).");
      }
    } finally {
      setBusy(false);
    }
  }

  // Cancella TUTTI i dati dello scenario medicine (voti, consensi, chat):
  // serve a togliere le prove prima dell'evento. Mostra prima i conteggi e
  // chiede di scrivere DELETE.
  async function clearTestData() {
    setBusy(true);
    try {
      const c = await fetch("/api/admin/clear-test-data", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!c) {
        setNotice("Could not read the data to clear. Please try again.");
        return;
      }
      const typed = window.prompt(
        `Clear ALL data of the outbreak scenario?\n\nThis permanently deletes ${c.votes} team answers, ${c.voteEvents} vote history entries, ${c.consents} consent records and ${c.messages} chat messages, then reopens voting. Use it only to remove tests before the event.\n\nType DELETE to confirm.`,
      );
      if (typed === null) return;
      if (typed.trim() !== "DELETE") {
        setNotice("Nothing deleted: the confirmation text did not match.");
        return;
      }
      const r = await fetch("/api/admin/clear-test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.deleted) {
        setPinned(null);
        setFocus(null);
        setNotice(
          `Test data cleared: ${d.deleted.votes} answers, ${d.deleted.voteEvents} vote history entries, ${d.deleted.consents} consent records and ${d.deleted.messages} chat messages deleted. Voting is open.`,
        );
        await load();
      } else {
        setNotice("Clearing failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const groupName = useCallback(
    (g: Group) => (reveal ? `Assistant ${g.index} · ${g.orientation}` : `Assistant ${g.index}`),
    [reveal],
  );
  // Variante per le frasi: "Assistant 1 (Precaution)".
  const groupInSentence = useCallback(
    (g: Group) => (reveal ? `Assistant ${g.index} (${g.orientation})` : `Assistant ${g.index}`),
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
    const allScores = data.teams.flatMap((t) =>
      CHOICES.map((c) => t.votes[c.id]?.option)
        .filter((o): o is OptionKey => Boolean(o))
        .map(optionScore),
    );
    const overall = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;
    return { teamsVoted, recorded, byGroup, overall };
  }, [data]);

  // Frase di sintesi per la proiezione: chi ha spinto verso risposte più forti
  // e chi verso risposte più leggere (nomi neutri finché non si rivela).
  const takeaway = useMemo(() => {
    if (!data || !stats) return null;
    const withData = stats.byGroup.filter((g): g is typeof g & { mean: number } => g.mean !== null);
    if (withData.length < 2) return null;
    const sorted = [...withData].sort((a, b) => b.mean - a.mean);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const gap = top.mean - bottom.mean;
    const provisional =
      stats.teamsVoted < data.teams.length
        ? ` (Provisional: ${stats.teamsVoted} of ${data.teams.length} teams have voted.)`
        : "";
    if (gap < 0.5) {
      return `All assistants led to similar choices: their averages are within ${fmt(gap)} points of each other, so there is no clear sign that the assistant made a difference.${provisional}`;
    }
    return `Teams that talked to ${groupInSentence(top.group)} chose the strongest responses (average ${fmt(top.mean)}); teams that talked to ${groupInSentence(bottom.group)} chose the lightest (average ${fmt(bottom.mean)}). That is a gap of ${fmt(gap)} points on a scale from 1 to 4.${provisional}`;
  }, [data, stats, groupInSentence]);

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
          <a className="admin-btn" href="/api/admin/export" title="Team answers: one row per team and choice">
            Votes (CSV)
          </a>
          <a
            className="admin-btn"
            href="/api/admin/export/vote-log"
            title="Every change to a team answer, in time order, with who made it"
          >
            Vote log (CSV)
          </a>
          <a
            className="admin-btn"
            href="/api/admin/export/chats"
            title="Conversations of consenting participants: one row per message"
          >
            Chats (CSV)
          </a>
          <a
            className="admin-btn"
            href="/api/admin/export/all"
            title="Everything for analysis: team answers, conversations by participant, consent records"
          >
            All data (JSON)
          </a>
          <button type="button" className="admin-btn danger" onClick={() => resetVotes()} disabled={!data || busy}>
            Reset all votes
          </button>
          <button type="button" className="admin-btn danger" onClick={clearTestData} disabled={!data || busy}>
            Clear test data
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
          <section className="event-row" aria-label="Event">
            <span className="event-name">Event</span>
            {eventDraft === null ? (
              <>
                <strong>{data.eventLabel || "not set"}</strong>
                <button type="button" className="link-btn" onClick={() => setEventDraft(data.eventLabel ?? "")}>
                  {data.eventLabel ? "Change" : "Set"}
                </button>
                {!data.eventLabel && (
                  <span className="event-hint">
                    Set a label before the event (e.g. STAT-2026-12-03): it is saved with every chat, vote and
                    consent.
                  </span>
                )}
              </>
            ) : (
              <form className="event-form" onSubmit={saveEvent}>
                <input
                  className="event-input"
                  value={eventDraft}
                  maxLength={60}
                  autoFocus
                  placeholder="e.g. STAT-2026-12-03"
                  onChange={(e) => setEventDraft(e.target.value)}
                />
                <button type="submit" className="admin-btn" disabled={busy}>
                  Save
                </button>
                <button type="button" className="admin-btn ghost" onClick={() => setEventDraft(null)}>
                  Cancel
                </button>
              </form>
            )}
          </section>

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
              <div className="kpi-label">Research consent (people)</div>
              <div className="kpi-value">
                {data.consents ? `${data.consents.agreed} yes · ${data.consents.declined} no` : "—"}
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
              Did the assistant change how strongly teams responded?
            </h2>
            <p className="card-sub">
              Every team had the same scenario and the same six choices. The only difference was the AI
              assistant they talked to. Each option picked is scored from <strong>A = 1</strong>, the
              lightest response (e.g. &ldquo;no alert&rdquo;, &ldquo;the market opens as planned&rdquo;), to{" "}
              <strong>D = 4</strong>, the strongest (e.g. &ldquo;request national support&rdquo;, &ldquo;the
              market is postponed&rdquo;). A team&apos;s position is the average of its scores.
            </p>
            <div className="how-to-read">
              <strong>How to read it.</strong> If the assistants were neutral, all four rows would sit in
              roughly the same place. Rows far apart mean that teams talking to different assistants made
              systematically different choices: a sign that the assistant steered them.
            </div>
            {takeaway && <p className="takeaway">{takeaway}</p>}
            <div className="dots-legend" aria-label="Legend">
              <span className="dots-legend-item">
                <span className="lg-dot" aria-hidden="true" />
                One team (average of its choices)
              </span>
              <span className="dots-legend-item">
                <span className="lg-tick" aria-hidden="true" />
                Average of the assistant&apos;s two teams
              </span>
              {stats.overall !== null && (
                <span className="dots-legend-item">
                  <span className="lg-ref" aria-hidden="true" />
                  Average of all teams ({fmt(stats.overall)})
                </span>
              )}
            </div>
            <div className="dots">
              <div className="dots-row dots-headrow" aria-hidden="true">
                <div className="dots-label" />
                <div className="dots-plot">
                  {stats.overall !== null && (
                    <span className="dots-ref-label" style={{ left: pos(stats.overall) }}>
                      All teams {fmt(stats.overall)}
                    </span>
                  )}
                </div>
                <div className="dots-value-head">Average (1–4)</div>
              </div>
              {stats.byGroup.map(({ group, means, mean, n }) => {
                const missing = means.filter((x) => x.mean === null).map((x) => x.team.label);
                return (
                  <div key={group.id} className="dots-row">
                    <div className="dots-label">
                      {groupName(group)}
                      {missing.length > 0 && missing.length < means.length && (
                        <span className="dots-label-sub">{missing.join(", ")}: no votes yet</span>
                      )}
                    </div>
                    <div className="dots-plot">
                      {[1, 2, 3, 4].map((sc) => (
                        <span key={sc} className="dots-grid" style={{ left: pos(sc) }} />
                      ))}
                      {stats.overall !== null && (
                        <span className="dots-ref" style={{ left: pos(stats.overall) }} />
                      )}
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
                            style={{ left: pos(m), top: i === 0 ? "28%" : "72%" }}
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
                              {team.label}
                            </span>
                          </span>
                        ),
                      )}
                      {means.every((x) => x.mean === null) && (
                        <span className="dots-empty">No votes yet</span>
                      )}
                    </div>
                    <div className="dots-value">{mean === null ? "—" : fmt(mean)}</div>
                  </div>
                );
              })}
              <div className="dots-row dots-axis" aria-hidden="true">
                <div className="dots-label" />
                <div className="dots-plot">
                  {OPTION_KEYS.map((k, i) => (
                    <span key={k} className="dots-tick" style={{ left: pos(i + 1) }}>
                      {k} = {i + 1}
                    </span>
                  ))}
                </div>
                <div className="dots-value" />
              </div>
              <div className="dots-row dots-scale" aria-hidden="true">
                <div className="dots-label" />
                <div className="dots-scale-bar">
                  <span>&larr; lighter response</span>
                  <span>stronger response &rarr;</span>
                </div>
                <div className="dots-value" />
              </div>
            </div>
            <div className="readout" aria-live="polite">
              {(() => {
                const t = hoverTeam && data.teams.find((x) => x.team === hoverTeam);
                if (!t) return "Point at a dot to see that team's choices.";
                const g = data.groups.find((x) => x.id === t.group);
                const { mean: m, n } = teamMean(t);
                const picks = CHOICES.map((c) => `${c.id}: ${t.votes[c.id]?.option ?? "–"}`).join(" · ");
                return `${t.label}${g ? ` (${groupName(g)})` : ""}: average ${m === null ? "—" : fmt(m)} over ${n} of ${CHOICES.length} choices — ${picks}`;
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

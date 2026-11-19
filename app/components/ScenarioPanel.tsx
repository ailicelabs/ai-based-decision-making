"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHOICES,
  CHOICE_IDS,
  MAX_JUSTIFICATION,
  OPTION_KEYS,
  SCENARIO,
  type OptionKey,
  type TeamVote,
  type TeamVotes,
} from "@/lib/scenarios/medicine";

// Pannello accanto alla chat (scenario medicine): lo scenario e la scheda di
// voto della squadra. Una scheda per squadra: tutti i dispositivi con lo
// stesso codice vedono e modificano le stesse risposte. Salvataggio
// automatico; ogni 10 s si riallinea con il server (senza toccare ciò che
// l'utente sta scrivendo o salvando).

const POLL_MS = 10_000;
const TYPE_DEBOUNCE_MS = 900;

type Patch = { option?: OptionKey; justification?: string };
type SaveState = "idle" | "saving" | "saved" | "error";

const EMPTY: TeamVote = { option: null, justification: "" };

export default function ScenarioPanel() {
  const [votes, setVotes] = useState<TeamVotes>({});
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Scelte con modifiche non ancora confermate dal server: il polling non le tocca.
  const pending = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const drafts = useRef(new Map<string, string>());
  const failed = useRef(new Map<string, Patch>());
  const focused = useRef<string | null>(null);
  const inflight = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/votes", { cache: "no-store" });
      if (!r.ok) {
        if (r.status === 503) setUnavailable(true);
        return;
      }
      const d = await r.json();
      setUnavailable(false);
      setOpen(Boolean(d?.open));
      const server: TeamVotes = d?.votes ?? {};
      setVotes((prev) => {
        const next: TeamVotes = { ...prev };
        for (const id of CHOICE_IDS) {
          if (pending.current.has(id) || focused.current === id) continue;
          const sv = server[id];
          next[id] = { option: sv?.option ?? null, justification: sv?.justification ?? "" };
        }
        return next;
      });
      setLoaded(true);
    } catch {
      // rete assente: riprova al prossimo giro
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  // Salvataggio di una modifica parziale (solo opzione o solo giustificazione).
  const send = useCallback(async (choice: string, patch: Patch) => {
    pending.current.add(choice);
    inflight.current += 1;
    setSaveState("saving");
    let ok = false;
    let closed = false;
    try {
      const r = await fetch("/api/votes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, ...patch }),
      });
      if (r.status === 409) {
        closed = true;
        setOpen(false);
      } else if (r.ok) {
        ok = true;
      }
    } catch {
      // gestito sotto
    } finally {
      inflight.current -= 1;
    }
    if (closed) {
      // Voto chiuso dall'admin: niente da ritentare; il polling riallinea.
      failed.current.delete(choice);
      pending.current.delete(choice);
      if (inflight.current === 0) setSaveState(failed.current.size > 0 ? "error" : "idle");
      return;
    }
    if (ok) {
      const prev = failed.current.get(choice);
      if (prev) {
        // Toglie dai fallimenti solo i campi appena salvati.
        const rest: Patch = { ...prev };
        if (patch.option !== undefined) delete rest.option;
        if (patch.justification !== undefined) delete rest.justification;
        if (rest.option === undefined && rest.justification === undefined) failed.current.delete(choice);
        else failed.current.set(choice, rest);
      }
      if (!failed.current.has(choice) && !timers.current.has(choice)) pending.current.delete(choice);
    } else {
      failed.current.set(choice, { ...failed.current.get(choice), ...patch });
    }
    if (inflight.current === 0) {
      setSaveState(failed.current.size > 0 ? "error" : ok ? "saved" : "error");
    }
  }, []);

  function update(choice: string, change: Partial<TeamVote>) {
    setVotes((prev) => ({ ...prev, [choice]: { ...(prev[choice] ?? EMPTY), ...change } }));
  }

  function pickOption(choice: string, option: OptionKey) {
    if (!open) return;
    update(choice, { option });
    send(choice, { option });
  }

  function flushText(choice: string) {
    const timer = timers.current.get(choice);
    if (!timer) return;
    clearTimeout(timer);
    timers.current.delete(choice);
    send(choice, { justification: drafts.current.get(choice) ?? "" });
  }

  function typeText(choice: string, value: string) {
    if (!open) return;
    const text = value.slice(0, MAX_JUSTIFICATION);
    update(choice, { justification: text });
    drafts.current.set(choice, text);
    pending.current.add(choice);
    const prev = timers.current.get(choice);
    if (prev) clearTimeout(prev);
    timers.current.set(
      choice,
      setTimeout(() => {
        timers.current.delete(choice);
        send(choice, { justification: drafts.current.get(choice) ?? "" });
      }, TYPE_DEBOUNCE_MS),
    );
  }

  function retry() {
    for (const [choice, patch] of Array.from(failed.current.entries())) send(choice, patch);
  }

  const answered = CHOICES.filter((c) => votes[c.id]?.option).length;

  // Le scelte raggruppate per decisione (2a/2b e 4a/4b sotto la stessa).
  const sections: { title: string; items: typeof CHOICES }[] = [];
  for (const c of CHOICES) {
    const last = sections[sections.length - 1];
    if (last && last.title === c.section) last.items.push(c);
    else sections.push({ title: c.section, items: [c] });
  }

  return (
    <div className="panel-inner">
      <section className="scn" aria-labelledby="scn-title">
        <h2 id="scn-title" className="scn-title">
          {SCENARIO.title}
        </h2>
        <div className="scn-when">{SCENARIO.when}</div>
        <p className="scn-lead">{SCENARIO.lead}</p>
        <p>{SCENARIO.body}</p>
        <dl className="scn-facts">
          {SCENARIO.facts.map(([k, v]) => (
            <div key={k} className="scn-fact">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="scn-context">{SCENARIO.context}</p>
      </section>

      <section className="vote" aria-labelledby="vote-title">
        <div className="vote-head">
          <h2 id="vote-title" className="vote-title">
            Your team&apos;s decisions
          </h2>
          <span className="vote-progress">{answered}/{CHOICES.length} chosen</span>
        </div>
        <p className="vote-note">
          One set of answers per team: everyone using your team&apos;s code sees and edits the same
          answers. Changes are saved automatically.
        </p>

        {unavailable && (
          <div className="vote-banner" role="status">
            Voting is not available right now. Use the paper answer sheet.
          </div>
        )}
        {!open && (
          <div className="vote-banner" role="status">
            Voting is closed. Your team&apos;s answers have been recorded.
          </div>
        )}

        {sections.map((s) => (
          <div key={s.title} className="vote-section">
            <h3 className="vote-section-title">{s.title}</h3>
            {s.items.map((c) => {
              const v = votes[c.id] ?? EMPTY;
              const sub = s.items.length > 1;
              return (
                <fieldset key={c.id} className="choice" disabled={!open || !loaded}>
                  <legend className="choice-q">
                    {sub && <span className="choice-sub">{c.label}. </span>}
                    {c.question}
                  </legend>
                  <div className="opts">
                    {OPTION_KEYS.map((k) => (
                      <label key={k} className={`opt${v.option === k ? " on" : ""}`}>
                        <input
                          type="radio"
                          name={`choice-${c.id}`}
                          value={k}
                          checked={v.option === k}
                          onChange={() => pickOption(c.id, k)}
                        />
                        <span className="opt-key" aria-hidden="true">
                          {k}
                        </span>
                        <span className="opt-text">{c.options[k]}</span>
                      </label>
                    ))}
                  </div>
                  <textarea
                    className="just"
                    rows={2}
                    placeholder="Why? (2–3 lines)"
                    aria-label={`Justification for ${c.label}`}
                    value={v.justification}
                    onChange={(e) => typeText(c.id, e.target.value)}
                    onFocus={() => {
                      focused.current = c.id;
                    }}
                    onBlur={() => {
                      focused.current = null;
                      flushText(c.id);
                    }}
                  />
                </fieldset>
              );
            })}
          </div>
        ))}

        <div className={`save-state ${saveState}`} role="status" aria-live="polite">
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "All changes saved"}
          {saveState === "error" && (
            <>
              Some changes were not saved.{" "}
              <button type="button" className="link-btn" onClick={retry}>
                Retry
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

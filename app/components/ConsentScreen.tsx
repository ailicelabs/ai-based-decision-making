"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Schermata di consenso alla ricerca, mostrata dopo il codice di accesso e
// prima della chat. Il testo (con versione) arriva da /api/consent, nella
// lingua dello scenario. Chi non acconsente partecipa comunque: la sua
// conversazione non viene salvata.

const T = {
  it: {
    loading: "Caricamento…",
    adult: "Ho almeno 18 anni.",
    agree: "Ho letto le informazioni qui sopra e acconsento all'uso dei miei dati anonimi a fini di ricerca.",
    accept: "Acconsento e partecipo",
    decline: "Partecipo senza condividere i miei dati",
    declineNote: "Se non acconsenti puoi comunque svolgere l'attività: la tua conversazione non verrà salvata.",
    error: "Si è verificato un errore. Riprova.",
    version: "Versione del testo",
  },
  en: {
    loading: "Loading…",
    adult: "I am 18 years of age or older.",
    agree: "I have read the information above and agree that my anonymous data are used for research.",
    accept: "I agree and take part",
    decline: "Take part without sharing my data",
    declineNote: "If you do not agree you can still do the activity: your conversation will not be stored.",
    error: "Something went wrong. Please try again.",
    version: "Text version",
  },
};

export default function ConsentScreen({
  lang,
  onDone,
}: {
  lang: "it" | "en";
  onDone: (consent: boolean) => void;
}) {
  const t = T[lang];
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/consent", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!active) return;
        setMarkdown(String(d?.markdown ?? ""));
        setVersion(String(d?.version ?? ""));
      })
      .catch(() => active && setError(t.error));
    return () => {
      active = false;
    };
  }, [t.error]);

  async function submit(consent: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agree: consent, adult: consent ? adult : undefined }),
      });
      if (!r.ok) throw new Error();
      onDone(consent);
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center consent-page">
      <div className="consent">
        {markdown === null ? (
          <div className="muted">{error || t.loading}</div>
        ) : (
          <>
            <div className="consent-text md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            </div>
            <div className="consent-checks">
              <label className="consent-check">
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                <span>{t.adult}</span>
              </label>
              <label className="consent-check">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{t.agree}</span>
              </label>
            </div>
            {error && (
              <div className="gate-error" role="alert">
                {error}
              </div>
            )}
            <div className="consent-actions">
              <button
                type="button"
                className="btn"
                onClick={() => submit(true)}
                disabled={busy || !adult || !agree}
              >
                {t.accept}
              </button>
              <button type="button" className="consent-decline" onClick={() => submit(false)} disabled={busy}>
                {t.decline}
              </button>
            </div>
            <p className="consent-note">{t.declineNote}</p>
            {version && (
              <p className="consent-version">
                {t.version}: {version}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

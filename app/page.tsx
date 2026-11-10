"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type Attachment, MAX_FILE_BYTES, classifyFile } from "@/lib/upload";

type Msg = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,text/markdown,.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.md";

// Mostrata nell'header per confermare a colpo d'occhio quale versione è online.
// Aggiornala a ogni release.
const APP_VERSION = "v1.1.2";

// La conversazione viene salvata qui nel browser (sessionStorage) così sopravvive
// a un refresh. Si azzera al logout, a un nuovo login e alla chiusura della scheda.
const CHAT_STORAGE_KEY = "adm_chat_v1";

// ---------------------------------------------------------------------------
// Testi dell'interfaccia. La lingua dipende dallo scenario della sessione
// (meteo = italiano, medicine = inglese) e arriva dal server con /api/session.
// Prima del login la lingua non è nota: il gate è volutamente minimale e in
// inglese (funziona per entrambi gli scenari).
// ---------------------------------------------------------------------------
type Lang = "it" | "en";

const GATE = {
  loading: "Loading…",
  placeholder: "Access code",
  invalid: "Invalid code, please try again.",
  network: "Network error, please try again.",
  checking: "Checking…",
  enter: "Enter",
};

// Branding dell'header dopo il login, per scenario (deciso dal codice inserito).
//  mark: "iuss" = logo IUSS, "art" = illustrazione del gate in miniatura
//  subtitle: riga sotto il titolo; null = nessuna riga
type Scenario = "meteo" | "medicine";

const BRAND: Record<Scenario, { mark: "iuss" | "art"; subtitle: string | null }> = {
  meteo: { mark: "iuss", subtitle: "Evento di Orientamento · IUSS Pavia" },
  medicine: { mark: "art", subtitle: "STAT PhD School" },
};

const STRINGS = {
  it: {
    logout: "Esci",
    logoutConfirm: "Uscire e tornare alla schermata di accesso?",
    empty: "Scrivi un messaggio per iniziare la conversazione.",
    placeholder: "Scrivi un messaggio…",
    send: "Invia",
    attach: "Allega un file",
    removeAtt: "Rimuovi allegato",
    errGeneric: "Si è verificato un errore. Riprova.",
    errNetwork: "Si è verificato un errore di rete.",
    uploadFailed: "Errore durante il caricamento del file.",
    fileTooBig: (name: string) => `"${name}" supera il limite di 5 MB.`,
    fileUnreadable: (name: string) => `Impossibile leggere "${name}".`,
    fileUnsupported: (name: string) => `Tipo di file non supportato: "${name}".`,
  },
  en: {
    logout: "Exit",
    logoutConfirm: "Log out and return to the access screen?",
    empty: "Write a message to start the conversation.",
    placeholder: "Write a message…",
    send: "Send",
    attach: "Attach a file",
    removeAtt: "Remove attachment",
    errGeneric: "Something went wrong. Please try again.",
    errNetwork: "A network error occurred.",
    uploadFailed: "Error while uploading the file.",
    fileTooBig: (name: string) => `"${name}" exceeds the 5 MB limit.`,
    fileUnreadable: (name: string) => `Could not read "${name}".`,
    fileUnsupported: (name: string) => `Unsupported file type: "${name}".`,
  },
};

function parseLang(value: unknown): Lang | null {
  return value === "it" || value === "en" ? value : null;
}

function parseScenario(value: unknown): Scenario | null {
  return value === "meteo" || value === "medicine" ? value : null;
}

function persistMessages(msgs: Msg[]) {
  try {
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs));
  } catch {
    // Quota superata (di solito immagini pesanti): salva senza i dati delle immagini.
    try {
      const light = msgs.map((m) =>
        m.attachments
          ? {
              ...m,
              attachments: m.attachments.map((a) =>
                a.type === "image" ? { type: "image" as const, name: a.name, dataUrl: "" } : a,
              ),
            }
          : m,
      );
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(light));
    } catch {
      // rinuncia silenziosamente
    }
  }
}

// Illustrazione del gate: prova /gate-art.png (mettilo in public/); se il file
// manca si nasconde e il gate resta senza immagine.
function GateArt() {
  const [hide, setHide] = useState(false);
  if (hide) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="gate-art" src="/gate-art.png" alt="" onError={() => setHide(true)} />
  );
}

// Logo IUSS: prova /iuss-logo.png (mettilo in public/), poi il placeholder
// /iuss-logo.svg, infine si nasconde. Così basta caricare il file vero.
function IussLogo({ className }: { className?: string }) {
  const [src, setSrc] = useState("/iuss-logo.png");
  const [hide, setHide] = useState(false);
  if (hide) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt="IUSS – Scuola Universitaria Superiore Pavia"
      onError={() => {
        if (src !== "/iuss-logo.svg") setSrc("/iuss-logo.svg");
        else setHide(true);
      }}
    />
  );
}

export default function Home() {
  // null = sto controllando se esiste già una sessione
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [lang, setLang] = useState<Lang>("it");
  const [scenario, setScenario] = useState<Scenario>("meteo");
  const t = STRINGS[lang];
  const brand = BRAND[scenario];

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);

  // Sessione esistente? (evita di rimostrare il gate dopo un refresh)
  // Se valida, ripristina la conversazione salvata nel browser.
  useEffect(() => {
    let active = true;
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const ok = Boolean(d?.ok);
        const savedLang = parseLang(d?.lang);
        if (savedLang) setLang(savedLang);
        const savedScenario = parseScenario(d?.scenario);
        if (savedScenario) setScenario(savedScenario);
        if (ok) {
          try {
            const saved = sessionStorage.getItem(CHAT_STORAGE_KEY);
            if (saved) setMessages(JSON.parse(saved) as Msg[]);
          } catch {
            // ignora dati corrotti
          }
        } else {
          try {
            sessionStorage.removeItem(CHAT_STORAGE_KEY);
          } catch {}
        }
        setAuthed(ok);
        hydratedRef.current = true;
      })
      .catch(() => {
        if (!active) return;
        setAuthed(false);
        hydratedRef.current = true;
      });
    return () => {
      active = false;
    };
  }, []);

  // Titolo della scheda e lingua del documento: neutri sul gate, per scenario
  // dopo il login.
  useEffect(() => {
    const base = "AI-Based Decision Making";
    document.title = authed && brand.subtitle ? `${base} — ${brand.subtitle}` : base;
    document.documentElement.lang = authed ? lang : "en";
  }, [authed, brand.subtitle, lang]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Salva la conversazione nel browser a ogni cambiamento (dopo l'idratazione,
  // per non sovrascrivere quella ripristinata con un array vuoto).
  useEffect(() => {
    if (!hydratedRef.current) return;
    persistMessages(messages);
  }, [messages]);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || authLoading) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const newLang = parseLang(data?.lang);
        if (newLang) setLang(newLang);
        const newScenario = parseScenario(data?.scenario);
        if (newScenario) setScenario(newScenario);
        // Nuovo accesso = conversazione pulita.
        try {
          sessionStorage.removeItem(CHAT_STORAGE_KEY);
        } catch {}
        setMessages([]);
        setAuthed(true);
        setCode("");
      } else {
        setAuthError(GATE.invalid);
      }
    } catch {
      setAuthError(GATE.network);
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    if (!window.confirm(t.logoutConfirm)) return;
    try {
      await fetch("/api/session", { method: "DELETE" });
    } catch {
      // anche se la rete fallisce, riportiamo l'utente al gate
    }
    try {
      sessionStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {}
    setMessages([]);
    setInput("");
    setAttachments([]);
    setNotice("");
    setAuthed(false);
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // permette di ri-selezionare lo stesso file
    if (files.length === 0) return;
    setNotice("");
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          setNotice(t.fileTooBig(file.name));
          continue;
        }
        const kind = classifyFile(file.name, file.type);
        if (kind === "image") {
          const dataUrl = await readAsDataUrl(file);
          setAttachments((a) => [...a, { type: "image", name: file.name, dataUrl }]);
        } else if (kind === "document") {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/upload", { method: "POST", body: fd });
          if (!res.ok) {
            setNotice(t.fileUnreadable(file.name));
            continue;
          }
          const data = await res.json();
          setAttachments((a) => [
            ...a,
            { type: "document", name: data.name ?? file.name, text: data.text ?? "" },
          ]);
        } else {
          setNotice(t.fileUnsupported(file.name));
        }
      }
    } catch {
      setNotice(t.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((a) => a.filter((_, i) => i !== idx));
  }

  async function sendMessage() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending || uploading) return;
    setInput("");
    const outgoing = attachments;
    setAttachments([]);
    const userMsg: Msg = {
      role: "user",
      content: text,
      attachments: outgoing.length ? outgoing : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      if (!res.ok || !res.body) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: t.errGeneric },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: t.errNetwork },
      ]);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoGrow(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  }

  if (authed === null) {
    return (
      <main className="center">
        <div className="muted">{GATE.loading}</div>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="center">
        <form className="gate" onSubmit={submitCode}>
          <GateArt />
          <div className="gate-head">
            <h1 className="gate-title">AI-Based Decision Making</h1>
          </div>
          <div className="gate-form">
            <div className="input-wrap">
              <span className="input-icon" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="access-code"
                className="gate-input"
                type={showCode ? "text" : "password"}
                autoComplete="off"
                autoFocus
                placeholder={GATE.placeholder}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="input-toggle"
                onClick={() => setShowCode((s) => !s)}
                aria-label={showCode ? "Hide code" : "Show code"}
                title={showCode ? "Hide" : "Show"}
              >
                {showCode ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.6 10.6a3 3 0 0 0 4.24 4.24" />
                    <path d="M16.7 16.7A9.8 9.8 0 0 1 12 18c-6.5 0-10-6-10-6a16.2 16.2 0 0 1 4.06-4.94" />
                    <path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 6 10 6a16.3 16.3 0 0 1-1.9 2.6" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {authError && (
              <div className="gate-error" role="alert">
                {authError}
              </div>
            )}
            <button className="btn gate-btn" type="submit" disabled={authLoading || !code.trim()}>
              {authLoading ? (
                GATE.checking
              ) : (
                <>
                  {GATE.enter}
                  <svg className="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="chat">
      <header className="chat-header">
        <div className="header-left">
          {brand.mark === "iuss" ? (
            <IussLogo className="header-logo" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="header-art" src="/gate-art.png" alt="" />
          )}
          <div className="header-titles">
            <span className="header-title-row">
              <span className="header-title">AI-Based Decision Making</span>
              <span className="header-version">{APP_VERSION}</span>
            </span>
            {brand.subtitle && <span className="header-event">{brand.subtitle}</span>}
          </div>
        </div>
        <button className="header-logout" type="button" onClick={logout} title={t.logout}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          {t.logout}
        </button>
      </header>
      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">{t.empty}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`row ${m.role}`}>
            <div className="bubble">
              {m.attachments && m.attachments.length > 0 && (
                <div className="bubble-atts">
                  {m.attachments.map((a, j) =>
                    a.type === "image" && a.dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} className="bubble-img" src={a.dataUrl} alt={a.name} />
                    ) : (
                      <span key={j} className="bubble-doc">
                        {a.type === "image" ? "🖼️" : "📄"} {a.name}
                      </span>
                    ),
                  )}
                </div>
              )}
              {m.role === "assistant" ? (
                m.content ? (
                  <div className="md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                ) : sending ? (
                  "…"
                ) : null
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        {attachments.length > 0 && (
          <div className="att-row">
            {attachments.map((a, i) => (
              <span key={i} className="chip">
                {a.type === "image" ? "🖼️" : "📄"} {a.name}
                <button
                  className="chip-x"
                  onClick={() => removeAttachment(i)}
                  aria-label={t.removeAtt}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}
        <div className="composer-row">
          <button
            className="icon-btn"
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || sending}
            title={t.attach}
          >
            {uploading ? "…" : "+"}
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept={ACCEPT}
            onChange={onPickFiles}
          />
          <textarea
            className="composer-input"
            rows={1}
            placeholder={t.placeholder}
            value={input}
            onChange={autoGrow}
            onKeyDown={onKeyDown}
          />
          <button
            className="btn send"
            onClick={sendMessage}
            disabled={sending || uploading || (!input.trim() && attachments.length === 0)}
          >
            {t.send}
          </button>
        </div>
      </div>
    </main>
  );
}

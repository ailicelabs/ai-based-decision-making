"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type Attachment, MAX_FILE_BYTES, classifyFile } from "@/lib/upload";

type Msg = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,text/markdown,.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.md";

// La conversazione viene salvata qui nel browser (sessionStorage) così sopravvive
// a un refresh. Si azzera al logout, a un nuovo login e alla chiusura della scheda.
const CHAT_STORAGE_KEY = "adm_chat_v1";

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
        // Nuovo accesso = conversazione pulita.
        try {
          sessionStorage.removeItem(CHAT_STORAGE_KEY);
        } catch {}
        setMessages([]);
        setAuthed(true);
        setCode("");
      } else {
        setAuthError("Codice non valido. Riprova.");
      }
    } catch {
      setAuthError("Errore di rete. Riprova.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    if (!window.confirm("Uscire e tornare alla schermata di accesso?")) return;
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
          setNotice(`"${file.name}" supera il limite di 5 MB.`);
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
            setNotice(`Impossibile leggere "${file.name}".`);
            continue;
          }
          const data = await res.json();
          setAttachments((a) => [
            ...a,
            { type: "document", name: data.name ?? file.name, text: data.text ?? "" },
          ]);
        } else {
          setNotice(`Tipo di file non supportato: "${file.name}".`);
        }
      }
    } catch {
      setNotice("Errore durante il caricamento del file.");
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
          { role: "assistant", content: "Si è verificato un errore. Riprova." },
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
        { role: "assistant", content: "Si è verificato un errore di rete." },
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
        <div className="muted">Caricamento…</div>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="center">
        <form className="gate" onSubmit={submitCode}>
          <IussLogo className="gate-logo" />
          <div className="gate-head">
            <h1 className="gate-title">AI-Based Decision Making</h1>
            <p className="gate-event">Evento di Orientamento · IUSS Pavia</p>
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
                placeholder="Inserisci il codice di accesso"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="input-toggle"
                onClick={() => setShowCode((s) => !s)}
                aria-label={showCode ? "Nascondi codice" : "Mostra codice"}
                title={showCode ? "Nascondi" : "Mostra"}
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
                "Verifica…"
              ) : (
                <>
                  Entra
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
          <IussLogo className="header-logo" />
          <div className="header-titles">
            <span className="header-title">AI-Based Decision Making</span>
            <span className="header-event">Evento di Orientamento · IUSS Pavia</span>
          </div>
        </div>
        <button className="header-logout" type="button" onClick={logout} title="Esci">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          Esci
        </button>
      </header>
      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">Scrivi un messaggio per iniziare la conversazione.</div>
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
                  aria-label="Rimuovi allegato"
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
            title="Allega un file"
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
            placeholder="Scrivi un messaggio…"
            value={input}
            onChange={autoGrow}
            onKeyDown={onKeyDown}
          />
          <button
            className="btn send"
            onClick={sendMessage}
            disabled={sending || uploading || (!input.trim() && attachments.length === 0)}
          >
            Invia
          </button>
        </div>
      </div>
    </main>
  );
}

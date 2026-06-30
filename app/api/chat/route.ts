import { cookies } from "next/headers";
import OpenAI from "openai";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildSystemPrompt } from "@/lib/prompts";
import { logMessage } from "@/lib/db";
import { type Attachment, MAX_DOC_CHARS } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};

const MAX_HISTORY = 30;
const MAX_IMAGE_DATAURL = 8_000_000; // ~6 MB binari in base64

type Param = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;

function sanitizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (o.type === "image" && typeof o.dataUrl === "string" && typeof o.name === "string") {
      out.push({ type: "image", name: o.name.slice(0, 200), dataUrl: o.dataUrl });
    } else if (o.type === "document" && typeof o.text === "string" && typeof o.name === "string") {
      out.push({ type: "document", name: o.name.slice(0, 200), text: o.text.slice(0, MAX_DOC_CHARS) });
    }
  }
  return out.slice(0, 6);
}

function validImageDataUrl(u: string): boolean {
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(u)) return false;
  return u.length <= MAX_IMAGE_DATAURL;
}

function attachmentMarkers(atts: Attachment[]): string {
  return atts
    .map((a) => (a.type === "image" ? `[immagine: ${a.name}]` : `[documento: ${a.name}]`))
    .join(" ");
}

function lastUserIndex(msgs: ChatMessage[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") return i;
  return -1;
}

// Costruisce i messaggi per OpenAI. Gli allegati (immagini + testo dei
// documenti) vengono espansi solo sull'ULTIMO messaggio utente, per contenere
// costi e dimensione del contesto; nei messaggi precedenti restano dei segnaposto.
function buildOpenAIMessages(msgs: ChatMessage[], system: string): Param[] {
  const lui = lastUserIndex(msgs);
  const out: Param[] = [{ role: "system", content: system }];

  msgs.forEach((m, i) => {
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
      return;
    }
    const atts = m.attachments ?? [];
    if (atts.length === 0) {
      out.push({ role: "user", content: m.content });
      return;
    }
    if (i !== lui) {
      out.push({ role: "user", content: `${m.content}\n${attachmentMarkers(atts)}`.trim() });
      return;
    }
    // Ultimo messaggio utente: allega tutto.
    let text = m.content || "";
    for (const a of atts) {
      if (a.type === "document") {
        text += `\n\n[Documento allegato: ${a.name}]\n${a.text.slice(0, MAX_DOC_CHARS)}`;
      }
    }
    const parts: Part[] = [{ type: "text", text: text.trim() || "(vedi allegati)" }];
    for (const a of atts) {
      if (a.type === "image" && validImageDataUrl(a.dataUrl)) {
        parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
      }
    }
    out.push({ role: "user", content: parts });
  });

  return out;
}

export async function POST(req: Request) {
  // 1) Sessione (la condizione vive solo qui, lato server).
  const store = await cookies();
  const session = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return new Response("Unauthorized", { status: 401 });

  // 2) Messaggi dal client.
  let rawMessages: unknown[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.messages)) rawMessages = body.messages;
  } catch {
    // body non valido
  }

  const messages: ChatMessage[] = rawMessages
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
      attachments: m.role === "user" ? sanitizeAttachments(m.attachments) : undefined,
    }))
    .slice(-MAX_HISTORY);

  if (messages.length === 0) return new Response("Bad Request", { status: 400 });

  // 3) Configurazione OpenAI.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response("Server non configurato (OPENAI_API_KEY mancante)", { status: 500 });

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const parsedTemp = Number(process.env.OPENAI_TEMPERATURE);
  const temperature = Number.isFinite(parsedTemp) ? parsedTemp : 0.5;
  const system = buildSystemPrompt(session.condition);
  const openaiMessages = buildOpenAIMessages(messages, system);

  // Testo per il log dell'ultimo messaggio utente (niente contenuti grezzi dei file).
  const lui = lastUserIndex(messages);
  const lastUser = lui >= 0 ? messages[lui] : null;
  const lastUserLog = lastUser
    ? [lastUser.content, attachmentMarkers(lastUser.attachments ?? [])].filter(Boolean).join(" ").trim()
    : "";

  // 4) Streaming + log a fine generazione.
  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      temperature,
      stream: true,
      messages: openaiMessages,
    });
  } catch (err) {
    console.error("OpenAI error:", err);
    return new Response("Errore nella chiamata al modello", { status: 502 });
  }

  const encoder = new TextEncoder();
  let full = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            controller.enqueue(encoder.encode(delta));
          }
        }
      } catch (err) {
        console.error("stream error:", err);
        controller.enqueue(encoder.encode("\n[errore durante la generazione]"));
      }

      // Log PRIMA di chiudere, così la function serverless resta viva.
      if (lastUserLog) await logMessage(session.sid, session.condition, "user", lastUserLog);
      if (full) await logMessage(session.sid, session.condition, "assistant", full);

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

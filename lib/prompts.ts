import fs from "node:fs";
import path from "node:path";
import type { Condition } from "./conditions";
import { buildPolicyPreamble } from "./policy";

// I 4 prompt vivono in file Markdown separati, uno per condizione, nella cartella
// /prompts. Vedi prompts/README.md. Qui li carichiamo lato server e anteponiamo
// il guardrail condiviso (policy.ts), uguale per tutte le condizioni.
const FILES: Record<Condition, string> = {
  no_bias: "no-bias.md",
  bias_1: "bias-1.md",
  bias_2: "bias-2.md",
  bias_3: "bias-3.md",
};

const FALLBACK = "Sei un assistente utile. Rispondi in italiano.";

const cache = new Map<Condition, string>();

function loadPrompt(condition: Condition): string {
  // In produzione leggiamo una volta e mettiamo in cache; in sviluppo rileggiamo
  // sempre, così le modifiche ai .md si vedono senza riavviare.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && cache.has(condition)) return cache.get(condition)!;

  try {
    const file = path.join(process.cwd(), "prompts", FILES[condition]);
    const raw = fs.readFileSync(file, "utf8");
    // Rimuove i commenti HTML (note per l'autore) prima di inviare al modello.
    const cleaned = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
    const result = cleaned || FALLBACK;
    cache.set(condition, result);
    return result;
  } catch (err) {
    console.error(`Prompt mancante o illeggibile per "${condition}":`, err);
    return FALLBACK;
  }
}

export function buildSystemPrompt(condition: Condition): string {
  const body = loadPrompt(condition);
  // Guardrail condiviso (uguale per tutte le condizioni) + prompt della condizione.
  return `${buildPolicyPreamble()}\n\n---\n\nISTRUZIONI ASSISTENTE:\n${body}`;
}

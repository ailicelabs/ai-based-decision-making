import fs from "node:fs";
import path from "node:path";
import type { Condition } from "./conditions";
import { buildPolicyPreamble } from "./policy";

// I prompt vivono in file Markdown nella cartella /prompts (vedi prompts/README.md):
//  - _common.md            -> compito comune, uguale per tutti e 4 i gruppi
//  - <condizione>.md       -> comportamento specifico del gruppo
// Qui li carichiamo lato server e li assembliamo con il guardrail condiviso
// (policy.ts). Solo il file della condizione cambia tra i gruppi.
const FILES: Record<Condition, string> = {
  group_a: "group-a.md",
  group_b: "group-b.md",
  group_c: "group-c.md",
  group_d: "group-d.md",
};

const COMMON_FILE = "_common.md";
const FALLBACK = "Sei un assistente utile. Rispondi in italiano.";

const cache = new Map<string, string>();

// Legge un file da /prompts, rimuove i commenti HTML (note per l'autore) e
// restituisce il testo. In produzione legge una volta e mette in cache; in
// sviluppo rilegge sempre, così le modifiche ai .md si vedono subito.
function readPromptFile(filename: string): string {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && cache.has(filename)) return cache.get(filename)!;
  try {
    const file = path.join(process.cwd(), "prompts", filename);
    const cleaned = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
    cache.set(filename, cleaned);
    return cleaned;
  } catch (err) {
    console.error(`Prompt file illeggibile: ${filename}`, err);
    return "";
  }
}

export function buildSystemPrompt(condition: Condition): string {
  const common = readPromptFile(COMMON_FILE);
  const behavior = readPromptFile(FILES[condition]) || FALLBACK;

  const parts: string[] = [buildPolicyPreamble()];
  if (common) parts.push(`COMPITO (uguale per tutti i gruppi):\n${common}`);
  parts.push(`COMPORTAMENTO DELL'ASSISTENTE (specifico di questo gruppo):\n${behavior}`);

  return parts.join("\n\n---\n\n");
}

import fs from "node:fs";
import path from "node:path";
import { type Condition, type Scenario, scenarioOf } from "./conditions";
import { buildPolicyPreamble } from "./policy";

// I prompt vivono in file Markdown nella cartella /prompts, una sottocartella
// per scenario (vedi prompts/README.md):
//  - <scenario>/_common.md   -> compito comune, uguale per tutti e 4 i gruppi
//  - <scenario>/group-*.md   -> comportamento specifico del gruppo
// Qui li carichiamo lato server e li assembliamo con il guardrail condiviso
// (policy.ts). All'interno di uno scenario, solo il file del gruppo cambia.
const FILES: Record<Condition, string> = {
  group_a: "meteo/group-a.md",
  group_b: "meteo/group-b.md",
  group_c: "meteo/group-c.md",
  group_d: "meteo/group-d.md",
  med_group_a: "medicine/group-a.md",
  med_group_b: "medicine/group-b.md",
  med_group_c: "medicine/group-c.md",
  med_group_d: "medicine/group-d.md",
};

const COMMON_FILE: Record<Scenario, string> = {
  meteo: "meteo/_common.md",
  medicine: "medicine/_common.md",
};

// Etichette delle sezioni del system prompt, nella lingua dello scenario.
const LABELS: Record<Scenario, { common: string; behavior: string; fallback: string }> = {
  meteo: {
    common: "COMPITO (uguale per tutti i gruppi):",
    behavior: "COMPORTAMENTO DELL'ASSISTENTE (specifico di questo gruppo):",
    fallback: "Sei un assistente utile. Rispondi in italiano.",
  },
  medicine: {
    common: "TASK (shared by all groups):",
    behavior: "ASSISTANT BEHAVIOR (specific to this group):",
    fallback: "You are a helpful assistant. Reply in English.",
  },
};

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
  const scenario = scenarioOf(condition);
  const labels = LABELS[scenario];
  const common = readPromptFile(COMMON_FILE[scenario]);
  const behavior = readPromptFile(FILES[condition]) || labels.fallback;

  const parts: string[] = [buildPolicyPreamble(scenario)];
  if (common) parts.push(`${labels.common}\n${common}`);
  parts.push(`${labels.behavior}\n${behavior}`);

  return parts.join("\n\n---\n\n");
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Scenario } from "./conditions";

// Testo di consenso per scenario: content/consent/<scenario>.md.
// Ogni consenso viene salvato con:
//  - versionLabel: la riga <!-- version: ... --> del file (leggibile);
//  - versionHash: impronta SHA-256 del testo esatto mostrato al partecipante,
//    così si può sempre dimostrare cosa è stato accettato.

export type ConsentText = { markdown: string; versionLabel: string; versionHash: string };

const cache = new Map<Scenario, ConsentText>();

export function loadConsentText(scenario: Scenario): ConsentText | null {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && cache.has(scenario)) return cache.get(scenario)!;
  try {
    const file = path.join(process.cwd(), "content", "consent", `${scenario}.md`);
    const raw = fs.readFileSync(file, "utf8");
    const label = raw.match(/<!--\s*version:\s*([^\s]+)\s*-->/)?.[1] ?? "unversioned";
    const markdown = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
    const versionHash = crypto.createHash("sha256").update(markdown).digest("hex").slice(0, 16);
    const out = { markdown, versionLabel: label, versionHash };
    cache.set(scenario, out);
    return out;
  } catch (err) {
    console.error(`Consent text unreadable for scenario ${scenario}`, err);
    return null;
  }
}

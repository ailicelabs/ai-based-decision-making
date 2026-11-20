// =============================================================================
//  SCENARI E CONDIZIONI SPERIMENTALI
//
//  Due dimensioni:
//   - scenario: quale esercitazione (meteo = emergenza idrogeologica, in
//     italiano; medicine = focolaio infettivo, in inglese)
//   - gruppo: quale bias nascosto (A/B/C/D, vedi prompts/README.md)
//
//  La condizione è una stringa unica "scenario+gruppo" così cookie di sessione,
//  log su database e tipo `Condition` restano invariati rispetto alla v1
//  (i valori storici group_a..group_d appartengono allo scenario meteo).
// =============================================================================

export type Scenario = "meteo" | "medicine";
export type Lang = "it" | "en";

export type Condition =
  // scenario meteo (valori storici, già presenti nei log della v1)
  | "group_a"
  | "group_b"
  | "group_c"
  | "group_d"
  // scenario medicine
  | "med_group_a"
  | "med_group_b"
  | "med_group_c"
  | "med_group_d";

export const CONDITIONS: Condition[] = [
  "group_a",
  "group_b",
  "group_c",
  "group_d",
  "med_group_a",
  "med_group_b",
  "med_group_c",
  "med_group_d",
];

export function scenarioOf(condition: Condition): Scenario {
  return condition.startsWith("med_") ? "medicine" : "meteo";
}

// Lingua dell'attività (interfaccia + risposte dell'assistente) per scenario.
export function languageOf(scenario: Scenario): Lang {
  return scenario === "medicine" ? "en" : "it";
}

export function isCondition(v: unknown): v is Condition {
  return typeof v === "string" && (CONDITIONS as string[]).includes(v);
}

// -----------------------------------------------------------------------------
//  SQUADRE (solo scenario medicine): 8 codici, 2 squadre per orientamento.
//  Il gruppo decide il comportamento dell'assistente; la squadra identifica
//  chi vota (un voto per squadra). Mappatura fissa squadra -> gruppo:
//  1-2 = A, 3-4 = B, 5-6 = C, 7-8 = D. Vive solo lato server.
// -----------------------------------------------------------------------------
export type MedTeam = { team: string; label: string; condition: Condition; envVar: string };

export const MED_TEAMS: MedTeam[] = [
  { team: "T1", label: "Team 1", condition: "med_group_a", envVar: "ACCESS_CODE_MED_TEAM_1" },
  { team: "T2", label: "Team 2", condition: "med_group_a", envVar: "ACCESS_CODE_MED_TEAM_2" },
  { team: "T3", label: "Team 3", condition: "med_group_b", envVar: "ACCESS_CODE_MED_TEAM_3" },
  { team: "T4", label: "Team 4", condition: "med_group_b", envVar: "ACCESS_CODE_MED_TEAM_4" },
  { team: "T5", label: "Team 5", condition: "med_group_c", envVar: "ACCESS_CODE_MED_TEAM_5" },
  { team: "T6", label: "Team 6", condition: "med_group_c", envVar: "ACCESS_CODE_MED_TEAM_6" },
  { team: "T7", label: "Team 7", condition: "med_group_d", envVar: "ACCESS_CODE_MED_TEAM_7" },
  { team: "T8", label: "Team 8", condition: "med_group_d", envVar: "ACCESS_CODE_MED_TEAM_8" },
];

// Etichetta leggibile della squadra ("Team 5"), uguale in tutti gli export.
export function teamLabel(team: string | null | undefined): string | null {
  if (!team) return null;
  return MED_TEAMS.find((t) => t.team === team)?.label ?? team;
}

export function isMedTeam(v: unknown): v is string {
  return typeof v === "string" && MED_TEAMS.some((t) => t.team === v);
}

// Gruppi dello scenario medicine come li mostra l'area admin: neutri
// ("Assistant 1–4") finché non si rivela l'orientamento.
export const MED_GROUPS: { condition: Condition; index: number; orientation: string }[] = [
  { condition: "med_group_a", index: 1, orientation: "Precaution" },
  { condition: "med_group_b", index: 2, orientation: "Uncertainty" },
  { condition: "med_group_c", index: 3, orientation: "Costs & false alarms" },
  { condition: "med_group_d", index: 4, orientation: "Consensus & reassurance" },
];

// Orientamento per lettera di gruppo: uguale nei due scenari (vedi prompts/README.md).
const ORIENTATION_BY_LETTER: Record<string, string> = {
  a: "Precaution",
  b: "Uncertainty",
  c: "Costs & false alarms",
  d: "Consensus & reassurance",
};

export function groupLetterOf(condition: string): string {
  return condition.slice(-1).toUpperCase();
}

export function orientationOf(condition: string): string {
  return ORIENTATION_BY_LETTER[condition.slice(-1)] ?? "";
}

export type Access = { condition: Condition; team: string | null };

// Mappa: codice di accesso -> condizione (+ squadra). Costruita a runtime dalle
// variabili d'ambiente, così i codici non finiscono nel repository.
function entries(): [string | undefined, Access][] {
  return [
    [process.env.ACCESS_CODE_GROUP_A, { condition: "group_a", team: null }],
    [process.env.ACCESS_CODE_GROUP_B, { condition: "group_b", team: null }],
    [process.env.ACCESS_CODE_GROUP_C, { condition: "group_c", team: null }],
    [process.env.ACCESS_CODE_GROUP_D, { condition: "group_d", team: null }],
    ...MED_TEAMS.map(
      (t): [string | undefined, Access] => [process.env[t.envVar], { condition: t.condition, team: t.team }],
    ),
  ];
}

// Confronto case-insensitive (riduce gli errori di battitura all'evento).
export function codeToAccess(input: string): Access | null {
  const code = input.trim().toLowerCase();
  if (!code) return null;
  for (const [configured, access] of entries()) {
    if (configured && configured.trim().toLowerCase() === code) {
      return access;
    }
  }
  return null;
}

// Quali squadre hanno un codice configurato (per l'area admin; mai i codici).
export function configuredTeams(): Set<string> {
  return new Set(MED_TEAMS.filter((t) => Boolean(process.env[t.envVar]?.trim())).map((t) => t.team));
}

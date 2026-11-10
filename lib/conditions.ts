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

// Mappa: codice di accesso -> condizione. Costruita a runtime dalle variabili
// d'ambiente, così i codici non finiscono nel repository.
function entries(): [string | undefined, Condition][] {
  return [
    [process.env.ACCESS_CODE_GROUP_A, "group_a"],
    [process.env.ACCESS_CODE_GROUP_B, "group_b"],
    [process.env.ACCESS_CODE_GROUP_C, "group_c"],
    [process.env.ACCESS_CODE_GROUP_D, "group_d"],
    [process.env.ACCESS_CODE_MED_GROUP_A, "med_group_a"],
    [process.env.ACCESS_CODE_MED_GROUP_B, "med_group_b"],
    [process.env.ACCESS_CODE_MED_GROUP_C, "med_group_c"],
    [process.env.ACCESS_CODE_MED_GROUP_D, "med_group_d"],
  ];
}

// Confronto case-insensitive (riduce gli errori di battitura all'evento).
export function codeToCondition(input: string): Condition | null {
  const code = input.trim().toLowerCase();
  if (!code) return null;
  for (const [configured, condition] of entries()) {
    if (configured && configured.trim().toLowerCase() === code) {
      return condition;
    }
  }
  return null;
}

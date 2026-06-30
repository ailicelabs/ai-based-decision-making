// Le 4 condizioni sperimentali: 4 gruppi, ciascuno con un bias diverso.
// Le chiavi sono interne e NON vengono mai esposte al browser.
//   group_a -> principio di precauzione
//   group_b -> incertezza
//   group_c -> costi e falsi allarmi
//   group_d -> procedure e protocolli
export type Condition = "group_a" | "group_b" | "group_c" | "group_d";

export const CONDITIONS: Condition[] = ["group_a", "group_b", "group_c", "group_d"];

// Mappa: codice di accesso -> gruppo. Costruita a runtime dalle variabili
// d'ambiente, così i codici non finiscono nel repository.
function entries(): [string | undefined, Condition][] {
  return [
    [process.env.ACCESS_CODE_GROUP_A, "group_a"],
    [process.env.ACCESS_CODE_GROUP_B, "group_b"],
    [process.env.ACCESS_CODE_GROUP_C, "group_c"],
    [process.env.ACCESS_CODE_GROUP_D, "group_d"],
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

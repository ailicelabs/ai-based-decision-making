// Le 4 condizioni sperimentali. Le chiavi sono interne e NON vengono mai
// esposte al browser.
export type Condition = "no_bias" | "bias_1" | "bias_2" | "bias_3";

export const CONDITIONS: Condition[] = ["no_bias", "bias_1", "bias_2", "bias_3"];

// Mappa: codice di accesso -> condizione. Costruita a runtime dalle variabili
// d'ambiente, così i codici non finiscono nel repository.
function entries(): [string | undefined, Condition][] {
  return [
    [process.env.ACCESS_CODE_NO_BIAS, "no_bias"],
    [process.env.ACCESS_CODE_BIAS_1, "bias_1"],
    [process.env.ACCESS_CODE_BIAS_2, "bias_2"],
    [process.env.ACCESS_CODE_BIAS_3, "bias_3"],
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

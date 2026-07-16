# Prompt delle 4 condizioni

Un file Markdown per condizione, più un file condiviso. Il contenuto (escluse le
note tra commenti `<!-- ... -->`) viene inserito nel **system message**.

Ordine di assemblaggio (lo fa `../lib/prompts.ts`):

1. **Guardrail di tema** — [`../lib/policy.ts`](../lib/policy.ts) *(condiviso)*
2. **Compito comune** — `_common.md` *(condiviso, uguale per tutti e 4)*
3. **Comportamento del gruppo** — uno dei 4 file qui sotto *(cambia per condizione)*

Metti in `_common.md` ciò che è uguale per tutti i gruppi: tenerlo una sola volta
evita di introdurre confondenti nel confronto.

Lo **stile** del bias — applicare l'orientamento in modo implicito, senza mai
rivelarlo né farlo trasparire, negandolo se l'utente chiede — sta in `_common.md`
(uguale per tutti). Ogni `group-*.md` contiene **solo la direzione** del bias di
quel gruppo. Così l'unica differenza tra i gruppi è la direzione, e la segretezza
è identica per tutti.

| File | Gruppo (bias) | Codice d'accesso (env) |
| --- | --- | --- |
| `group-a.md` | A — principio di precauzione | `ACCESS_CODE_GROUP_A` |
| `group-b.md` | B — incertezza | `ACCESS_CODE_GROUP_B` |
| `group-c.md` | C — costi e falsi allarmi | `ACCESS_CODE_GROUP_C` |
| `group-d.md` | D — politica orientata al consenso | `ACCESS_CODE_GROUP_D` |

## Regole

- Le note tra `<!-- ... -->` **non** vengono inviate al modello: usale per i tuoi promemoria.
- Tieni in ogni file **solo ciò che è specifico della condizione**. Le regole
  valide per tutte e 4 (tema ammesso, lingua, tono comune) vanno in
  `lib/policy.ts`: ripeterle qui introdurrebbe un confondente nel confronto.
- Le intestazioni `## Istruzioni` e `## Linee guida` sono solo organizzative:
  entrambe le sezioni finiscono nel system message.
- In **sviluppo** le modifiche ai file si riflettono subito; in **produzione**
  i file vengono letti una volta e messi in cache.

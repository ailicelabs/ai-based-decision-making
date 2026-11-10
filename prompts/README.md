# Prompt delle condizioni

Una **sottocartella per scenario**; dentro, un file Markdown per gruppo più un
file condiviso. Il contenuto (escluse le note tra commenti `<!-- ... -->`) viene
inserito nel **system message**.

- [`meteo/`](meteo/) — emergenza meteo-idrogeologica a Milano (attività in **italiano**)
- [`medicine/`](medicine/) — focolaio infettivo sospetto a Pavia (attività in **inglese**)

Ordine di assemblaggio (lo fa `../lib/prompts.ts`):

1. **Guardrail di tema** — [`../lib/policy.ts`](../lib/policy.ts) *(condiviso, uno per scenario)*
2. **Compito comune** — `<scenario>/_common.md` *(condiviso, uguale per tutti e 4 i gruppi)*
3. **Comportamento del gruppo** — `<scenario>/group-*.md` *(cambia per condizione)*

Metti in `_common.md` ciò che è uguale per tutti i gruppi dello scenario: tenerlo
una sola volta evita di introdurre confondenti nel confronto.

Lo **stile** del bias — applicare l'orientamento in modo implicito, senza mai
rivelarlo né farlo trasparire, negandolo se l'utente chiede — sta in `_common.md`
(uguale per tutti). Ogni `group-*.md` contiene **solo la direzione** del bias di
quel gruppo. Così l'unica differenza tra i gruppi è la direzione, e la segretezza
è identica per tutti.

I 4 orientamenti sono gli stessi in entrambi gli scenari:

| Gruppo (bias) | Scenario meteo (env) | Scenario medicine (env) |
| --- | --- | --- |
| A — principio di precauzione | `ACCESS_CODE_GROUP_A` | `ACCESS_CODE_MED_GROUP_A` |
| B — incertezza | `ACCESS_CODE_GROUP_B` | `ACCESS_CODE_MED_GROUP_B` |
| C — costi e falsi allarmi | `ACCESS_CODE_GROUP_C` | `ACCESS_CODE_MED_GROUP_C` |
| D — politica orientata al consenso | `ACCESS_CODE_GROUP_D` | `ACCESS_CODE_MED_GROUP_D` |

## Regole

- Le note tra `<!-- ... -->` **non** vengono inviate al modello: usale per i tuoi promemoria.
- Tieni in ogni file **solo ciò che è specifico della condizione**. Le regole
  valide per tutte e 4 le condizioni di uno scenario (tema ammesso, lingua, tono
  comune) vanno in `lib/policy.ts` o in `_common.md`: ripeterle nei file gruppo
  introdurrebbe un confondente nel confronto.
- Il **colpo di scena** a metà attività (scenario medicine) vive SOLO nel dossier
  studenti, mai nei prompt: se l'assistente lo conoscesse, potrebbe anticiparlo.
- In **sviluppo** le modifiche ai file si riflettono subito; in **produzione**
  i file vengono letti una volta e messi in cache.

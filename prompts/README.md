# Prompt delle 4 condizioni

Un file Markdown per condizione. Il contenuto (escluse le note tra commenti
`<!-- ... -->`) viene inserito nel **system message**, subito dopo il guardrail
condiviso definito in [`../lib/policy.ts`](../lib/policy.ts).

| File | Condizione | Codice d'accesso (env) |
| --- | --- | --- |
| `no-bias.md` | nessun bias | `ACCESS_CODE_NO_BIAS` |
| `bias-1.md` | bias 1 | `ACCESS_CODE_BIAS_1` |
| `bias-2.md` | bias 2 | `ACCESS_CODE_BIAS_2` |
| `bias-3.md` | bias 3 | `ACCESS_CODE_BIAS_3` |

## Regole

- Le note tra `<!-- ... -->` **non** vengono inviate al modello: usale per i tuoi promemoria.
- Tieni in ogni file **solo ciò che è specifico della condizione**. Le regole
  valide per tutte e 4 (tema ammesso, lingua, tono comune) vanno in
  `lib/policy.ts`: ripeterle qui introdurrebbe un confondente nel confronto.
- Le intestazioni `## Istruzioni` e `## Linee guida` sono solo organizzative:
  entrambe le sezioni finiscono nel system message.
- In **sviluppo** le modifiche ai file si riflettono subito; in **produzione**
  i file vengono letti una volta e messi in cache.

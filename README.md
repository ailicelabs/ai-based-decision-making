# Assistente — IUSS Pavia (evento di orientamento)

App web minimale: **gate con codice di accesso → chat tipo ChatGPT**. Il codice
inserito determina, **lato server**, quale dei 4 system prompt
(`no bias` / `bias 1` / `bias 2` / `bias 3`) viene usato. Le interfacce sono
identiche e i codici sono opachi: lo studente non sa in quale condizione si
trova. Le conversazioni vengono registrate in modo anonimo per l'analisi.

## Stack
- Next.js (App Router) + TypeScript
- OpenAI API (chiamata **solo** lato server, chiave mai esposta al browser)
- Postgres (Neon, integrazione nativa Vercel) per il log delle conversazioni
- Deploy su Vercel

## Setup locale
1. `npm install`
2. Copia `.env.local.example` in `.env.local` e compila i valori.
3. `npm run dev` → http://localhost:3000

## Dove mettere i CONTENUTI
- **Compito comune + comportamenti** → cartella [`prompts/`](prompts/):
  `_common.md` (compito uguale per tutti) e un file per gruppo (`group-a.md` …
  `group-d.md`). Vedi [`prompts/README.md`](prompts/README.md). Guardrail e compito
  comune vengono anteposti in automatico da `lib/prompts.ts`.
- **I 4 codici di accesso** → variabili d'ambiente (`.env.local` in locale, env
  di Vercel in produzione). Vedi `.env.local.example`.
- **Il tema consentito (guardrail)** → [`lib/policy.ts`](lib/policy.ts): scrivi il
  contesto/argomento ammesso e, se vuoi, personalizza il messaggio di rifiuto.

## Variabili d'ambiente
| Nome | Descrizione |
| --- | --- |
| `OPENAI_API_KEY` | chiave OpenAI (obbligatoria) |
| `OPENAI_MODEL` | modello, default `gpt-4o` |
| `OPENAI_TEMPERATURE` | creatività 0–1, default `0.5` (più basso = più coerente) |
| `SESSION_SECRET` | stringa casuale per firmare il cookie di sessione |
| `ACCESS_CODE_GROUP_A` / `_B` / `_C` / `_D` | codici dei 4 gruppi sperimentali (A/B/C/D) |
| `DATABASE_URL` | connessione Postgres (impostata in automatico dall'integrazione Neon su Vercel). Se assente, il log è disattivato. |

## Database
La tabella `messages` viene creata in automatico al primo log:

```
id | session_id | condition | role | content | created_at
```

Export per l'analisi (psql / console Vercel):

```sql
SELECT created_at, condition, session_id, role, content
FROM messages
ORDER BY created_at;
```

## Caricamento file
Gli studenti possono allegare:
- **immagini** (PNG/JPEG/WebP/GIF) → lette nativamente dal modello, che deve
  essere *vision-capable* (`gpt-4o` lo è);
- **documenti** (PDF/TXT/CSV/MD) → il testo viene estratto lato server (`unpdf`
  per i PDF) e accodato al contesto.

Limiti: **5 MB** per file, testo del documento troncato a **12.000 caratteri**.
Per contenere i costi le immagini vengono inviate al modello solo sull'**ultimo**
messaggio; nei messaggi precedenti restano dei segnaposto. Per **privacy** i file
non vengono salvati nel database: nel log resta solo il nome del file.

## Guardrail di tema
Uno **strato condiviso** (in [`lib/policy.ts`](lib/policy.ts)), identico per tutte
e 4 le condizioni — così non falsa il confronto sui bias — impedisce risposte
fuori dal contesto consentito. È un guardrail "morbido" (via prompt); se in futuro
serve più rigidità si può aggiungere un classificatore pre-check.

## Deploy su Vercel
1. Push del repo su GitHub.
2. Importa il progetto su Vercel.
3. Nella tab **Storage** crea un database **Neon** (Postgres) → `DATABASE_URL` viene aggiunta in automatico.
4. Aggiungi le altre env (tabella sopra) e fai il deploy.

## Note di design
- La condizione **non viene mai inviata al client**: vive in un cookie firmato
  (HMAC, httpOnly). Esperimento in cieco.
- Usa codici **opachi** (es. `alpha-7421`), non `bias1`, per non rivelare la condizione.

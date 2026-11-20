# Assistente — IUSS Pavia (evento di orientamento)

App web minimale: **gate con codice di accesso → chat tipo ChatGPT**. Il codice
inserito determina, **lato server**, lo **scenario** (emergenza meteo a Milano,
in italiano; focolaio infettivo a Pavia, in inglese) e quale dei 4 system prompt
con bias nascosto viene usato. Le interfacce sono identiche e i codici sono
opachi: lo studente non sa in quale condizione si trova. Le conversazioni
vengono registrate in modo anonimo per l'analisi.

Nello scenario **medicine** ogni codice identifica una **squadra** (8 squadre, 2
per orientamento): accanto alla chat c'è un pannello con lo scenario e la scheda
di voto della squadra (6 scelte, opzioni A–D + giustificazione). L'area admin
[`/admin`](app/admin/page.tsx) mostra i risultati per squadra e per assistente,
apre/chiude il voto, rivela gli orientamenti ed esporta il CSV.

## Stack
- Next.js (App Router) + TypeScript
- OpenAI API (chiamata **solo** lato server, chiave mai esposta al browser)
- Postgres (Neon, integrazione nativa Vercel) per il log delle conversazioni e i voti
- Deploy su Vercel

## Setup locale
1. `npm install`
2. Copia `.env.local.example` in `.env.local` e compila i valori.
3. `npm run dev` → http://localhost:3000

## Dove mettere i CONTENUTI
- **Compito comune + comportamenti** → cartella [`prompts/`](prompts/), una
  sottocartella per scenario (`meteo/`, `medicine/`), ognuna con `_common.md`
  (compito uguale per tutti) e un file per gruppo (`group-a.md` … `group-d.md`).
  Vedi [`prompts/README.md`](prompts/README.md). Guardrail e compito comune
  vengono anteposti in automatico da `lib/prompts.ts`.
- **I codici di accesso** (4 per lo scenario meteo, 8 squadre per lo scenario
  medicine) e il **codice admin** → variabili d'ambiente (`.env.local` in locale,
  env di Vercel in produzione). Vedi `.env.local.example`.
- **Testo dello scenario e opzioni del voto** (pannello + admin) →
  [`lib/scenarios/medicine.ts`](lib/scenarios/medicine.ts). Tienilo allineato con
  la scheda studenti e con `docs/activity-medicine-dossier.md`.
- **Il tema consentito (guardrail)** → [`lib/policy.ts`](lib/policy.ts): scrivi il
  contesto/argomento ammesso e, se vuoi, personalizza il messaggio di rifiuto.

## Variabili d'ambiente
| Nome | Descrizione |
| --- | --- |
| `OPENAI_API_KEY` | chiave OpenAI (obbligatoria) |
| `OPENAI_MODEL` | modello, default `gpt-4o` |
| `OPENAI_TEMPERATURE` | creatività 0–1, default `0.3` (più basso = più coerente) |
| `SESSION_SECRET` | stringa casuale per firmare il cookie di sessione |
| `ACCESS_CODE_GROUP_A` / `_B` / `_C` / `_D` | codici dei 4 gruppi — scenario **meteo** (italiano) |
| `ACCESS_CODE_MED_TEAM_1` … `_8` | codici delle 8 squadre — scenario **medicine** (inglese). Squadre 1-2 = gruppo A, 3-4 = B, 5-6 = C, 7-8 = D |
| `ADMIN_CODE` | codice dell'area `/admin` (risultati del voto). Senza, l'area admin resta chiusa |
| `DATABASE_URL` | connessione Postgres (impostata in automatico dall'integrazione Neon su Vercel). Se assente, log e voto sono disattivati (in locale il voto usa un archivio in memoria). |

## Database
Le tabelle vengono create in automatico al primo uso:

```
messages:  id | session_id | condition | team | role | content | created_at
votes:     team | condition | choice | option | justification | updated_by | updated_at
consents:  session_id | condition | team | consent | version_label | version_hash | created_at
app_state: key | value            (voting_open = true/false)
```

`condition` codifica scenario e gruppo: `group_a`…`group_d` per lo scenario
meteo (valori storici della v1), `med_group_a`…`med_group_d` per lo scenario
medicine. `team` (`T1`…`T8`) c'è solo nello scenario medicine. In `votes` c'è
una riga per squadra × scelta: un voto per squadra, modificabile finché il voto
è aperto (si chiude dall'area admin).

Dalla v1.3.0 i messaggi vengono salvati **solo** per i partecipanti che hanno
dato il consenso alla ricerca. Export per l'analisi (psql / console Vercel),
limitato alle sessioni con consenso:

```sql
SELECT m.created_at, m.condition, m.team, m.session_id, m.role, m.content,
       c.version_label AS consent_version
FROM messages m
JOIN consents c ON c.session_id = m.session_id AND c.consent
ORDER BY m.created_at;
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

## Export dei dati per l'analisi (area admin)
Tre pulsanti in alto nell'area `/admin`:

| Pulsante | File | Contenuto |
| --- | --- | --- |
| **Votes (CSV)** | `outbreak-votes-AAAA-MM-GG.csv` | stato finale: una riga per squadra × scelta, con gruppo, orientamento, opzione, punteggio 1–4, giustificazione, ora e autore (`updated_by`) dell'ultima modifica, evento |
| **Vote log (CSV)** | `vote-log-AAAA-MM-GG.csv` | **ogni** modifica ai voti in ordine di tempo (opzione o giustificazione), con chi l'ha fatta: mostra quando e dopo quale scambio una squadra ha cambiato idea |
| **Chats (CSV)** | `chats-AAAA-MM-GG.csv` | una riga per messaggio dei soli partecipanti con consenso: data, evento, scenario, gruppo, orientamento, squadra, `participant` (id anonimo della sessione), ruolo, testo, versione del consenso, modello, temperatura, versione dell'app, `prompt_hash` |
| **All data (JSON)** | `study-export-AAAA-MM-GG.json` | tutto insieme: risposte delle squadre, registro dei voti, conversazioni raggruppate per partecipante (con i metadati di ogni messaggio), registro completo dei consensi (anche i rifiuti, senza chat) |

I CSV si aprono direttamente in Excel (UTF-8 con BOM). Il JSON è pensato per R
o Python. Il campo `participant` collega i messaggi di una stessa persona, le
modifiche ai voti che ha fatto (`updated_by` / `participant` nel registro) e,
tramite `team`, il voto della sua squadra. Le date sono in UTC (ISO 8601).

- **Evento:** prima di ogni evento imposta nell'area admin l'etichetta (campo
  "Event", es. `STAT-2026-12-03`): viene salvata con ogni chat, voto, modifica e
  consenso, così gli eventi restano distinguibili nello studio aggregato.
- **`prompt_hash`:** impronta SHA-256 (16 caratteri) del system prompt esatto
  usato per quella risposta: se modifichi un prompt tra un evento e l'altro, i
  messaggi restano attribuibili alla versione giusta. `app_version` è la
  versione del badge (`lib/version.ts`).

## Consenso alla ricerca (tutti gli scenari)
Dopo il codice di accesso compare una schermata di consenso, nella lingua dello
scenario. Per accettare servono due spunte: maggiore età e consenso all'uso dei
dati anonimi. Chi non acconsente partecipa comunque: chat e (nello scenario
medicine) voto funzionano, ma **la sua conversazione non viene salvata**. Il
voto di squadra è collettivo e viene salvato comunque. Finché il partecipante
non risponde, chat e voto restano bloccati anche lato server.

- **Testi:** [`content/consent/meteo.md`](content/consent/meteo.md) (italiano) e
  [`content/consent/medicine.md`](content/consent/medicine.md) (inglese). Testo
  semplificato (responsabile + contatto, dati anonimi, servizio AI esterno,
  debriefing finale), in attesa di revisione del comitato etico.
- **Versione:** ogni file ha una riga `<!-- version: ... -->`; cambiala a ogni
  modifica. Ogni consenso è registrato in `consents` con quella versione e con
  l'impronta SHA-256 del testo esatto mostrato.
- **Ritiro:** i dati sono anonimi, quindi non è previsto il ritiro dopo
  l'attività (lo dice il testo).
- Il consenso non è retroattivo: le conversazioni salvate prima della v1.3.0 non
  hanno una riga in `consents` e la query qui sopra le esclude.

## Voto e area admin (scenario medicine)
- **Studenti:** il pannello salva in automatico (opzione e giustificazione
  separatamente, così due dispositivi della stessa squadra non si sovrascrivono)
  e ogni 10 s si riallinea con quanto inserito dai compagni.
- **Admin** (`/admin`, pagina non linkata, accesso con `ADMIN_CODE`): numero di
  squadre che hanno votato, livello medio di risposta per assistente
  (A = 1 … D = 4), griglia squadre × scelte con le giustificazioni, pulsanti per
  chiudere/riaprire il voto e per **rivelare gli orientamenti** (prima compaiono
  solo come "Assistant 1–4"), export CSV. I nomi degli orientamenti arrivano
  solo dall'API autenticata, mai dal JavaScript pubblico.
- **Azzeramento voti** (admin, con conferma): "Reset all votes" cancella le
  schede di tutte le squadre, "Reset" su una riga solo quella squadra. È
  definitivo: serve a togliere i voti di prova prima dell'evento (esporta il
  CSV prima, se ti serve). Non tocca il log delle chat (`messages`): le
  conversazioni di prova si escludono in analisi filtrando per `created_at`.
- **Pulizia delle prove** (admin, "Clear test data"): cancella **tutti** i dati
  dello scenario medicine (voti, consensi, chat) e riapre il voto. Mostra prima
  quanti record verranno eliminati e chiede di scrivere `DELETE`. Da usare solo
  prima dell'evento: dopo cancellerebbe i dati veri. Lo scenario meteo non viene
  toccato.

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
- Al browser arrivano solo scenario, lingua e presenza del pannello: gruppo e
  squadra restano nel cookie firmato e lato server.

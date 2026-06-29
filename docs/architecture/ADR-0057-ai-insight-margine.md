# ADR-0057 — AI insight margine

**Data:** 2026-06-30
**Stato:** Accettato
**Provenienza:** Decisione Nicolò — sblocco dell'insight differito in ADR-0054 §7. Seconda feature LLM del prodotto; primo riuso del modulo `ai/` (ADR-0056) fuori dalle comunicazioni.

---

## Contesto

ADR-0054 (report margine) **differiva esplicitamente** ogni insight AI (§7):

> «Niente Groq/insight in questa slice: senza tariffario gli importi sono parziali
> → un insight su dati incompleti è rumore. Rinviato a quando il tariffario
> (Task 3b) è implementato.»

Il **tariffario (Task 3b, #127)** è ora landed: `importoPrestazioni` è derivato
dal tariffario al momento della registrazione. La precondizione di ADR-0054 §7 è
quindi soddisfatta e l'insight diventa uno sblocco legittimo.

Resta una **copertura parziale sullo storico**: la derivazione è uno
_snapshot-at-create_, **senza backfill** → i mandati con prestazioni registrate
prima del tariffario hanno `importoPrestazioni = null` (parziale). Un insight che
ignorasse questo trarrebbe conclusioni di redditività su dati incompleti — l'esatto
rumore che §7 voleva evitare. La feature deve quindi rendere la copertura
**esplicita e verificabile**, non nasconderla.

ADR-0056 aveva previsto che `GroqService` fosse un **template riusabile** per
future feature AI: questa è la prima a esercitare quel riuso.

---

## Decisioni

### 1. `complete()` generico come fondamento riusabile

Il core di `GroqService` è estratto in
`complete(systemPrompt, userPrompt, { temperature?, maxTokens? })`: gestisce client
lazy, chiamata, e la mappatura errori su 503 con `errorCode` stabile
(`E_AI_DISABLED` / `E_AI_EMPTY` / `E_AI_UPSTREAM`). `suggerisciRisposta()`
(ADR-0056) è rifattorizzato per delegarvi — **comportamento invariato**, coperto
dai test di regressione esistenti.

### 2. `analizzaMargine(rows)` sopra `complete()`

Nuovo metodo che costruisce il prompt e delega a `complete()` con
`temperature: 0.3` (analisi, non creatività) e `max_tokens: 400`. Il system prompt
impone: sintesi ≤200 parole, italiano, nessun preambolo, e — cruciale — di
analizzare **esclusivamente i mandati presenti nei dati**, senza menzionare o
ipotizzare mandati assenti, dichiarando lo stato `MANCANTE/PARZIALE` **solo per il
mandato specifico** e senza caveat generici. La serializzazione utente marca tali
righe come `MANCANTE/PARZIALE` anziché con un numero. (La prima formulazione, più
generica, induceva il modello ad aggiungere caveat fantasma su mandati inesistenti
quando i dati erano sparsi — riscontrato in verifica runtime e corretto.)

Il tipo d'ingresso è `MargineRigaInsight`, interfaccia minima locale a
`groq.service.ts` (stesso pattern di `ThreadPerBozza`): disaccoppia `GroqService`
dal tipo `MargineRow` di `ReportService` ed evita la dipendenza inversa
`ai → report`. `MargineRow` è strutturalmente compatibile.

### 3. Sintesi globale, non per-mandato

Una sola sintesi sull'intero set di mandati (pattern, criticità trasversali,
suggerimenti operativi), non un insight per riga: una chiamata LLM per richiesta,
costo/latenza prevedibili, e il valore analitico sta nel confronto tra mandati.

### 4. Endpoint `POST /report/margine/insight`

`POST` (azione che invoca un provider esterno, non lettura idempotente cacheabile),
in `ReportController`. `ReportService.margineInsight(tenantId)` riusa `margine()`
per i dati, calcola la **copertura** (`{ totali, conPrestazioni }`) e delega la
sintesi a `GroqService`. La copertura è ritornata insieme all'insight così che il
FE possa mostrare un disclaimer **indipendente dal testo AI** (è un fatto sui dati,
non un'inferenza del modello).

### 4-bis. Guard `< 2 mandati` → path deterministico, niente Groq

Con meno di 2 mandati un'analisi **comparativa** non ha senso (e in verifica
runtime il modello, su input degenere a 1 mandato, riempiva la risposta con
commenti sull'assenza di altri mandati). `margineInsight` quindi short-circuita
**prima** di chiamare Groq quando `rows.length < 2` e ritorna `insight: null` +
`aiGenerated: false`, con `copertura` comunque corretta. Risparmia una chiamata
LLM e rimuove il rumore alla radice. Il guard vive in `ReportService`
(business-logic del report), non in `GroqService`, che resta un wrapper AI puro.

### 4-ter. `aiGenerated` flag → i18n FE, non italiano hardcoded dal BE

Le stringhe del path deterministico ("nessun mandato", "un solo mandato…") sono
**testo di prodotto** e devono rispettare la parità i18n IT/EN. Il BE NON le
restituisce hardcoded in italiano: ritorna `aiGenerated: false` (e `insight: null`)
e il FE rende la stringa localizzata dal proprio catalogo, interpolando nome/valore
dalle righe già caricate. La prosa AI (`aiGenerated: true`) resta invece in italiano
generato dall'LLM — effimera e non localizzata, coerente con ADR-0056. Così l'unico
testo non localizzato è quello intrinsecamente generato dal modello.

### 5. Riuso del permesso `report.operativo.visualizza`

Nessun nuovo permesso: l'insight aggrega dati già accessibili via `GET
/report/margine`, identico alla motivazione di ADR-0054 (alternativa «nuovo
permesso `report.margine.*`» già scartata lì).

### 6. Feature-flag e degradazione FE

`GET /ai/status` (ADR-0056) resta l'unico gate FE: se la key è assente il bottone
«Analizza con AI» non compare. Lo stato AI è caricato best-effort in parallelo ai
dati: un suo errore non blocca il report. Errore dell'insight → messaggio inline
(pattern `localError`, niente toast infra).

---

## API

`POST /api/v1/report/margine/insight` → `report.operativo.visualizza`

```ts
{
  data: {
    // prosa AI (italiano) se aiGenerated; null nel path deterministico (< 2 mandati)
    insight: string | null;
    aiGenerated: boolean;
    copertura: {
      totali: number;
      conPrestazioni: number;
    }
  }
}
```

`503` con `{ errorCode }` se la feature AI è disabilitata o il provider fallisce —
**solo** sul path AI (≥ 2 mandati). Con < 2 mandati la risposta è sempre `200`
deterministica, indipendente dalla key.

---

## Conseguenze

- Prima sintesi AI di redditività disponibile, con copertura esplicita: i margini
  critici e i pattern emergono in linguaggio naturale senza sostituire la tabella.
- `complete()` è ora il fondamento per ogni futura feature AI; ADR-0056 e ADR-0057
  ne sono i due primi consumatori.
- La copertura parziale sullo storico pre-tariffario è gestita su due livelli
  (campo `copertura` + vincolo nel system prompt), coerente con la cautela di
  ADR-0054 §7.

---

## Alternative considerate

- **Insight per-mandato** → scartato: N chiamate LLM, costo/latenza non lineari,
  poco valore rispetto alla sintesi comparativa.
- **`GET` con cache** → scartato: l'output non è deterministico e ogni richiesta
  consuma quota provider; `POST` riflette meglio l'azione.
- **Nuovo permesso `report.insight.*`** → scartato: aggrega dati già accessibili
  (coerente con ADR-0054).
- **Importare `MargineRow` in `groq.service.ts`** → scartato: creerebbe la
  dipendenza `ai → report` (oltre a `report → ai`); l'interfaccia minima locale la
  evita, come già per `ThreadPerBozza`.
- **Riabilitare l'insight senza disclaimer di copertura** → scartato: riproporrebbe
  il rumore su dati parziali che ADR-0054 §7 voleva evitare.

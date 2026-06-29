# ADR-0056 — AI draft risposta (comunicazioni)

**Data:** 2026-06-29
**Stato:** Accettato
**Provenienza:** Decisione Nicolò — Slice A (STOP 1). Prima integrazione LLM del prodotto; introduce il modulo `ai/` trasversale.

---

## Contesto

I thread di comunicazione studio↔cliente (ADR-0043) richiedono all'operatore di
redigere manualmente ogni risposta. Questa slice introduce una **bozza assistita
da AI**: l'operatore preme un bottone nel composer, un LLM genera una proposta di
risposta dal contesto del thread, la bozza popola la textarea ed è **editabile**
prima dell'invio. È il primo punto di integrazione LLM del prodotto, quindi le
decisioni qui valgono da template per future feature AI.

Provider scelto: **Groq** (`groq-sdk`), inferenza a bassa latenza su modelli open
(default `llama-3.3-70b-versatile`).

---

## Decisioni

### 1. Modulo `ai/` trasversale, non dentro comunicazioni

`GroqService` vive in `apps/accountant-api/src/ai/` ed è esportato da `AiModule`.
Comunicazioni lo importa via DI. Motivo: la capability AI non è specifica delle
comunicazioni; future feature (riassunti, triage) riusano lo stesso service senza
dipendere dal dominio comunicazioni.

### 2. Feature-flag a runtime su `GROQ_API_KEY`

Nessuna migration, nessun flag in DB. La feature è abilitata **sse** `GROQ_API_KEY`
è presente in ambiente (letta via `ConfigService`):

- `GroqService.isAvailable()` → `false` se key assente/vuota.
- `suggerisciRisposta()` lancia **503 `E_AI_DISABLED`** se invocata senza key.
- `GET /ai/status` (pubblico, no auth) espone `{ aiEnabled: boolean }` — **solo**
  il booleano, mai la key. Il FE decide da qui se mostrare il bottone.

Su un ambiente senza key la UI non mostra il bottone e l'endpoint resta inerte:
rollout/rollback = presenza della variabile, zero deploy di codice.

### 3. Nessuna persistenza

La bozza è **effimera**: generata on-demand, ritornata al FE, scartata se non
inviata. Nessun nuovo modello/colonna. Se l'operatore invia, passa per il normale
flusso `POST /comunicazioni/:id/messaggi` come testo qualsiasi (l'origine AI non
è tracciata in questa slice — eventuale audit è backlog).

### 4. Contesto del prompt: solo conversazione cliente↔studio

`ComunicazioniService.suggerisciRisposta` carica il thread (riuso `getById`) ed
**esclude le note interne** (`lato='interno'`, mai parte del dialogo col cliente)
prima di passarlo a Groq. Il prompt include `oggetto` + timeline dei messaggi,
limitata agli **ultimi 5** (anti token-overflow: redigere la risposta all'ultimo
messaggio non richiede l'intero storico). `mandati`/altri dati azienda **non**
entrano nel contesto in v1.

### 5. Prompt design

- **System:** ruolo (assistente studio commercialista IT), vincolo di stile
  (professionale, conciso, italiano) e di output (**solo** il testo della
  risposta, senza preamboli né firme).
- **User:** `Oggetto` + conversazione formattata `[Cliente|Studio] {testo}` +
  istruzione finale a rispondere all'ultimo messaggio del cliente.

### 6. Parametri di inferenza

| Parametro     | Valore                                   | Motivo                                                  |
| ------------- | ---------------------------------------- | ------------------------------------------------------- |
| `model`       | `GROQ_MODEL` o `llama-3.3-70b-versatile` | Override via env senza redeploy                         |
| `temperature` | `0.4`                                    | Output professionale poco creativo, deterministico q.b. |
| `max_tokens`  | `400`                                    | Una risposta email breve; tetto di costo/latenza        |

### 7. Mappatura errori → 503 con `errorCode` stabile

Tutti gli errori sono **503** (feature opzionale, mai blocca il flusso manuale):

- `E_AI_DISABLED` — key assente.
- `E_AI_EMPTY` — il modello ha restituito testo vuoto.
- `E_AI_UPSTREAM` — errore SDK/HTTP Groq (modello inesistente, rate-limit, rete);
  il dettaglio è loggato server-side, il client riceve un 503 generico.

Il FE mostra `comunicazioni.ai.errore` (toast/inline) e l'operatore scrive a mano.

### 8. Sicurezza / permessi

- `POST /comunicazioni/:id/suggerisci` sotto `comunicazioni.gestisci` (stessa gate
  dell'invio risposta).
- `GET /ai/status` `@Public`: non espone segreti, solo il flag derivato.
- La key non è mai loggata né serializzata in risposta.

---

## Conseguenze

- **Pro:** zero schema-change, rollout/rollback via env, capability AI riusabile,
  degradazione pulita (feature assente = UI invariata).
- **Contro:** dipendenza esterna (Groq) nel path di generazione; nessun audit
  dell'origine AI dei messaggi (accettato in v1); contesto limitato a 5 messaggi
  (può perdere dettagli di thread lunghi — accettato, override futuro).
- **Test:** unit con `groq-sdk` mockato (nessuna chiamata reale in CI); e2e
  dell'endpoint `:id/suggerisci` skippato se `GROQ_API_KEY` assente.

---

## Backlog / TD

- Tracciare l'origine AI dei messaggi inviati (audit).
- Includere contesto azienda/mandati nel prompt (valutare token-budget).
- Astrazione provider se si aggiunge un secondo LLM (oggi accoppiato a Groq).

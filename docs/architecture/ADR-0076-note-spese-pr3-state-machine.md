# ADR-0076 — Note Spese v1 PR-3 (state machine + gating)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [spec consolidata](../spec/note-spese-v1.md), [ADR-0075](./ADR-0075-note-spese-pr2-crud-storage.md) (CRUD+storage PR-2), [ADR-0074](./ADR-0074-note-spese-pr1-schema.md) (schema PR-1)

## Context

Terzo e ultimo blocco backend Note Spese (accountant): la **macchina a stati** (invia/approva/respingi) + i **gating** §4.1/§4.2, sopra il modulo CRUD di PR-2. **Tier MEDIO**: accountant-api only, **nessuno schema/migrazione/seed** (i campi decisionali `inviataAt`/`decisaAt`/`decisaDaId`/`motivoRifiuto` e gli stati esistono da PR-1). Branch `feat/note-spese-state-machine`.

## Decisions

### DP-1 / DP-2 — decisioni su §4.3 **ricostruito** (reversibili)

Il set delle transizioni §4.3 è stato **ricostruito dai test §7**, non è verbatim. **Divergenza rilevata in STOP 0**: la spec persistita `docs/spec/note-spese-v1.md` §4.3 recita `respinta → bozza`, mentre le decisioni lockate qui prendono un'altra strada. Registrate come **reversibili** — se emerge il testo originale divergente, si rivedono.

- **DP-1 (opzione A)**: `respinta → inviata` **diretta**. L'autore corregge via `PATCH` (già consentito su `{bozza, respinta}` da PR-2) e re-invia; **nessuna** transizione automatica dentro il `PATCH`. Non esiste endpoint `respinta → bozza`.
- **DP-2**: il re-invio da `respinta` **azzera** i campi decisionali (`decisaAt`, `decisaDaId`, `motivoRifiuto`). Ancoraggio: la spec dice "audit workflow (minimo, **no tabella storico**)" → quei campi sono **stato corrente**, non log; una nota `inviata` non deve esibire il motivo di un rifiuto superato.

### Macchina a stati (§1)

```
bozza     → inviata     (POST /invia,    autore)
respinta  → inviata     (POST /invia,    autore)   [DP-1]
inviata   → approvata   (POST /approva,  notespese.approva)
inviata   → respinta    (POST /respingi, notespese.approva)
```

`approvata` è **terminale**. Tutto il resto è vietato (`E_NOTASPESA_INVALID_TRANSITION`), incl. `approvata → *`, `bozza → approvata`, `respinta → approvata`, `inviata → inviata`.

### Gating (§4.1/§4.2) — nella stessa tx della transizione

- `invia` con `totale > 0` richiede un allegato `giustificativo` → altrimenti `E_NOTASPESA_GIUSTIFICATIVO_MANCANTE` (422).
- `invia` con `metodoPagamento ∈ {carta_aziendale, carta_personale}` richiede un allegato `scontrino_pos` → altrimenti `E_NOTASPESA_SCONTRINO_MANCANTE` (422).
- La presenza allegati è letta **dentro** la `withTenantContextAtomicTx` della transizione (spec §3), non prima.
- §4.5/§4.6 confermati: nessuna regola fiscale, nessuna validazione BE su `distanzaKm`.

### Ownership / auto-decisione

- `invia` è **autore-only** (`nota.userId === currentUser.id`): non basta il permesso; cross-user → 404 (non-leak, coerente con PR-2 `assertOwnEditable`).
- `approva`/`respingi` (`notespese.approva`): l'approvatore agisce su qualunque nota `inviata` del tenant (nessun ownership). **Auto-decisione vietata**: se `nota.userId === currentUser.id` → `E_NOTASPESA_AUTO_DECISIONE` (422). La spec nomina esplicitamente solo l'**auto-approvazione**; la guardia è **estesa anche al rifiuto** (auto-rifiuto) — coerente e prudente, estensione oltre il testo dichiarata (ribaltabile se Nicolò preferisce consentire l'auto-rifiuto).
- `respingi`: `motivo` **obbligatorio** (non vuoto/whitespace), enforced al **DTO** (HTTP) **e** nel service (defense-in-depth: la ValidationPipe non gira negli e2e service-level, TD-BS).

### Concorrenza (DP-3) — pattern scelto e perché

**`updateMany` con lo stato atteso nel `WHERE` + check `res.count`, dentro `withTenantContextAtomicTx`.** La race è chiusa dalla **condizione di update** (`WHERE ... stato ∈ {atteso}`), non da un read-then-write: due decisori simultanei su una nota `inviata` → il primo `updateMany` fa `count=1`, il secondo `count=0` → `E_NOTASPESA_INVALID_TRANSITION`. La lettura iniziale serve solo per 404/ownership/auto-decisione + un **fast-fail** sulla precondizione (che dà l'errore corretto — transizione vs gating — quando lo stato è palesemente sbagliato). I gating leggono gli allegati nella stessa tx.

**Perché non allinearsi alle macchine a stati esistenti**: `comande.cambiaStato` e `circolari.publish/archive` usano **read-then-write** (`findFirst` → check stato → `update`), che sotto READ COMMITTED è la race che DP-3 vieta esplicitamente. Il primitivo di concorrenza _corretto_ già in codebase è `SELECT … FOR UPDATE` in `withTenantContextAtomicTx` (counter di `mandati`/`comunicazioni`) e l'uso di `updateMany`+`count` (`comunicazioni`/`conti`). Ho scelto l'opzione **primaria** di DP-3 (`updateMany`+guardia) perché non richiede raw SQL e chiude la race in modo idiomatico; `FOR UPDATE` sarebbe l'equivalente. **Debito segnalato (non in scope)**: comande/circolari restano su read-then-write — se in futuro diventano concorrenti-sensibili, migrarle a questo pattern.

### Tassonomia errori (distinti per il FE)

`E_NOTASPESA_INVALID_TRANSITION` (409) · `E_NOTASPESA_GIUSTIFICATIVO_MANCANTE` (422) · `E_NOTASPESA_SCONTRINO_MANCANTE` (422) · `E_NOTASPESA_AUTO_DECISIONE` (422) · `E_NOTASPESA_MOTIVO_RICHIESTO` (400) · `E_NOTASPESA_NOT_FOUND` (404, riuso PR-2). `message` = errorCode nei DTO, oggetto `{errorCode, message}` nelle eccezioni service — convenzione esistente.

## Immutabilità §7.8 — verifica, non implementazione

PR-2 già limita `PATCH`/`POST allegato`/`DELETE allegato` a `stato ∈ {bozza, respinta}` (`assertOwnEditable` → `E_NOTASPESA_NOT_EDITABLE`) e `DELETE nota` a `bozza` (`E_NOTASPESA_NOT_DELETABLE`). **Verificato in STOP 0: nessun buco.** Il test T8 esercita i 4 vettori (PATCH/POST-allegato/DELETE-allegato/DELETE-nota) su `inviata` **e** `approvata` → tutti rifiutati.

## Test (§7 residui + DP)

`note-spese-state-machine.e2e-spec.ts`, service-level dal DI container: **6/6 verdi**. T4 (auto-approvazione + auto-rifiuto + controllo positivo decisore), T5 (giustificativo), T6 (scontrino), T7 (transizioni vietate: approvata→approvata/respinta, bozza→approvata, respinta→approvata), T8 (immutabilità), **T15** (respinta→inviata riesce + azzera i decisionali). Suite PR-2 (security 9/9 + gate RLS 5/5) **invariata**. Totale Note Spese: 9 (PR-2) + 6 (PR-3) = **15** (i 14 di spec + il nuovo su DP-2).

## Impatto altro verticale

**N.A. verificato.** Nessun tocco a `packages/db`, `platform`, seed, schema, migrazioni. Tutto in `apps/accountant-api` (service + controller + 1 DTO + 1 spec e2e).

## Consequences

- **Positive**: blocco Note Spese backend completo (CRUD + storage + state machine); concorrenza race-free sulle transizioni; gating atomico; errori distinti pronti per il FE (PR-4/5).
- **Costi/rischi**: DP-1/DP-2 poggiano su §4.3 ricostruito (divergenza `respinta → bozza` nella spec persistita) → reversibili. Auto-rifiuto è estensione oltre il testo. La migrazione Note Spese (PR-1) è su `main` ma **non ancora in produzione** (si applica al prossimo deploy) — tracciato in HANDOFF.

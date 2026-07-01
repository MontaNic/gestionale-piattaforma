# ADR-0063 — Tiering STOP-gate per rischio

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Supersedes:** nulla (raffina la prassi STOP-gate consolidata in [ADR-0059](./ADR-0059-smoke-funzionale-per-verticale-per-ruolo.md) / [ADR-0062](./ADR-0062-no-next-route-under-api.md))

## Context

Il lavoro segue un modello a tre attori (Nicolò orchestratore → Claude strategico spec/review → Claude Code esecutore) con workflow STOP-gate applicato **in modo uniforme** a ogni task: STOP 0 read-only → scope-lock → STOP 1 spec → STOP 2 self-check → review → merge autorizzato separatamente.

Osservazioni empiriche che motivano la revisione:

1. **Il gate uniforme non è calibrato sul rischio.** La stessa cerimonia (STOP 0 pieno + STOP 1 multi-gate) viene spesa su un utente seed idempotente coperto da CI e su un refactor di codice live. Il costo del gate è costante; il costo dell'errore no.
2. **Alcune classi di errore non sono prevenibili da alcun gate manuale.** Il bug `set-locale` (ADR-0062) era un'interazione runtime tra route Next, glob Caddy e prefisso Nest: emergeva solo eseguendo sull'infra reale. Nessuno STOP aggiuntivo l'avrebbe pescato. La cura efficace è stata **copertura eseguibile** (smoke ADR-0059 + CI guard ADR-0062), non più gate.
3. **Il collo di bottiglia è la staffetta umana, non la velocità di Code.** Ogni STOP è un ciclo copia-incolla-attendi a carico di Nicolò. Su task a basso rischio questo aggiunge latenza senza aggiungere sicurezza.
4. **Il processo stesso genera una quota di errori** (es. working tree condiviso contaminato, prompt che accoppiano `checks --watch` e `merge`). Più round-trip ≠ meno errori in modo monotono.

## Decision

Il workflow STOP-gate viene **tiered per rischio**. I GATE di verifica restano obbligatori in entrambi i tier; cambia solo quanti round-trip umani richiedono.

### Tier ALTO — STOP-gate pieno (STOP 0 → scope-lock → STOP 1 → STOP 2 → review → merge)

Si applica quando il task tocca **anche solo uno** di:

- ambiente **live** / deploy / container in esecuzione;
- **config condivisa**: Caddy, vitest, turbo, tsconfig, build, Docker;
- **migration** o qualsiasi scrittura su schema/dati non banalmente reversibile;
- **security**: RBAC, RLS, isolamento tenant, anti-traversal, IDOR, gestione secret;
- azioni **irreversibili o distruttive**.

Qui i tre attori con staffetta valgono il loro costo: il costo potenziale dell'errore (downtime, perdita dati, falla) domina il costo del gate.

### Tier BASSO — round-trip singolo (Code esegue baseline → implementazione → gate checks in sequenza; STOP **solo** a `gh pr create` per review + merge)

Si applica quando il task è **tutto** di:

- additivo e **idempotente**;
- **coperto da CI** (o la copertura viene aggiunta nel task stesso);
- **nessuna superficie live** toccata;
- reversibile (es. nuovi test, utenti/dati seed idempotenti, documentazione, refactor interni già coperti da suite verde).

### Invarianti (valgono in entrambi i tier)

- I GATE restano **obbligatori**: baseline pre-fix verde, idempotenza seed, conteggio permessi (array/DB count, mai `grep -c`), full suite verde, CHECK-\* di ADR-0052. Nel tier alto sono punti di STOP con conferma; nel tier basso sono check eseguiti da Code e riportati in un **self-check unico**.
- **Nicolò resta single decision-maker** sullo scope-lock (tier alto) e su **ogni** merge (entrambi i tier). Il tier basso non automatizza il merge: lo anticipa a un solo checkpoint.
- **Mai** `gh pr merge` nello stesso prompt di `gh pr create` / `gh pr checks --watch`, in nessun tier.
- **`git add` selettivo**, mai `-A`, in nessun tier.

### Principio guida

Il moltiplicatore di sicurezza è la **copertura automatica eseguibile** (CI guard, smoke, e2e), non il numero di STOP manuali. Ogni escape produttivo genera una **nuova guard eseguibile** (rif. ADR-0062), non un nuovo STOP.

### Default

In caso di dubbio sulla classificazione → **tier alto**.

## Consequences

- Meno round-trip umani sui task a basso rischio; il tempo di Nicolò si concentra sui punti dove l'errore costa.
- La regola sostituisce la decisione caso-per-caso su quanta cerimonia applicare.
- Rischio di mis-classificazione, mitigato da: default "in dubbio → tier alto", GATE obbligatori invariati, e review PR sempre presente prima del merge.
- La classificazione del tier va dichiarata esplicitamente all'apertura di ogni task.

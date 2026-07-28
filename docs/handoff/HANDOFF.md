# HANDOFF — gestionale-piattaforma

**Snapshot:** `Main @ f5ec71c (#195) (+1 commit docs(handoff) in arrivo via PR)`
**Chiusura sessione:** blocco Cassa pre-fiscale completo + deployato; design language avviato (seam + P2 completa) in `main`, non deployato. `main` verde pulito (0 flaky verificato su 4 run consecutivi).

---

# PARTE A — Stato

## Dove siamo

**Il loop restaurant `menu → tavoli → comande → KDS → cassa` è chiuso end-to-end, e la cassa è LIVE in produzione**, verificata nell'app reale (pagamento 201, guardia saldo D3 attiva, riepilogo IVA congelato esatto). È lo step di usabilità del piano a lungo termine: il verticale food è passato da demo a operabile in un servizio reale.

**Nota stato produzione (critica, non dimenticare):** NON ci sono clienti reali né dati di valore in prod. Tutto pre-lancio/demo. Il blast radius su superfici condivise ha stakes BASSI ora; "corruzione irrecuperabile" non è uno scenario reale finché non arrivano clienti. La disciplina STOP-gate/test resta utile come abitudine e rete PER QUANDO arriveranno, ma va calibrata sul rischio attuale (basso), non su uno immaginato.

## Cosa è in `main`

| Blocco                                                                                   | PR         | ADR  | In prod?     |
| ---------------------------------------------------------------------------------------- | ---------- | ---- | ------------ |
| Cassa PR1 — schema `Pagamento` + BE (pagamenti, storno, riepilogo IVA, guardia saldo D3) | #187       | 0081 | ✅ deployato |
| Cassa PR2 — contratto `chiudibile` + UI cassa                                            | #188       | 0082 | ✅ deployato |
| Design seam — `tokens.css` + `tailwind-preset`, 4 leggi, contratto 7×2                   | #189       | 0083 | ❌           |
| P2 endpoint — `GET /dashboard/stats` (4 aggregati)                                       | #190       | 0084 | ❌           |
| CI fix — Playwright senza apt (pg/ioredis)                                               | #192       | —    | (CI)         |
| P2 Badge — primitiva + token stati (6 var / 12 valori)                                   | #191       | 0085 | ❌           |
| P2 dashboard FE — rebuild, Badge prima cliente, migrazione sentinel                      | #193       | —    | ❌           |
| Fix flaky — single-flight deterministico (waiter espliciti)                              | #194, #195 | —    | ❌           |

**Deployato in prod:** solo la Cassa (PR1+PR2). Il seam e tutto P2 sono in `main` ma NON in prod. Il prossimo deploy porterà PR1-seam + P2 insieme.

## Deploy cassa — cosa è stato fatto

- Migration additiva `20260726215242_add_pagamento_cassa` applicata al DB prod condiviso (`Pagamento` + RLS + colonna `riepilogo_iva_snapshot`).
- **Riconciliazione Super Admin** all'invariante `ALL_PERMISSION_CODES` (idempotente, via `DIRECT_URL`): ha portato `cassa.pagamento.registra` + i 3 `notespese.*` arretrati ai ruoli Super Admin materializzati (60 permessi ciascuno). Ruoli operativi NON toccati (propagazione generale resta differita).
- **Primo deploy con rollback point vero:** tag `deploy/s19-f7b5d19` + immagini `gestionale/restaurant-{api,web}:rollback-s19-f7b5d19`. Migration e permessi additivi → rollback = solo-container, nessun rollback DB.

---

# PARTE B — Contesto, debiti, prossimi passi

## Registro TD (con trigger)

**Aperti — prioritari:**

- `TD-dev-env-punta-prod` — **ha morso 3 volte questa sessione** (quasi-incidente DB prod in sessioni precedenti; divergenza template↔DB accountant; kill di un processo dentro un container durante pulizia dev). Il criterio giusto: un comando di dev **non può** raggiungere un processo di prod, non "mi ricordo di verificare dopo". Check concreto emerso: risalire al `ppid` → `containerd-shim` = container. È il più affilato dei quattro failure mode strutturali.
- `TD-deploy-perm-reconcile-gate` — trigger: prossimo deploy che aggiunge permessi. Il check "permessi Super Admin prod == set del codice" va **scriptato come GATE pre-build**. Il debito di propagazione ha morso 3 volte (notespese S19, cassa S20, Direzione accountant di Studio Ferretti) — il trigger reale è "qualsiasi permesso aggiunto a un ruolo materializzato", non "primo tenant via API".
- `TD-ci-e2e-testcontainers-be` — pre-sessione; verificare se resta scoperto qualcosa nella copertura comportamentale in CI.

**Aperti — trigger-gated:**

- `TD-conti-list-amounts` — trigger: il cassiere deve prioritizzare i conti per importo dall'index. `GET /conti` è flat, senza importi. (`statoPagamento` non è badgeabile sulla dashboard per lo stesso motivo.)
- `TD-dashboard-service-day` — trigger: cliente reale con servizi oltre mezzanotte. "Oggi" = giorno solare Europe/Rome, non giorno di servizio.
- `TD-visual-regression-net` — trigger: prima di P4 (ritocco primitive condivise). Ridotto: il **diff dei valori CSS computati** copre già i cambi di token in modo deterministico; la rete screenshot serve solo per il residuo (geometria, spaziatura, ritorni a capo).
- `TD-smoke-punta-solo-a-prod` — trigger: serve una smoke per-ruolo gatante in CI su codice non deployato → il `baseURL` (oggi sull'URL pubblico) va parametrizzato su istanza effimera dal branch.
- `TD-e2e-validationpipe-missing` — il harness E2E non esercita il `ValidationPipe`: nessun DTO `@Body` è validato in e2e. Trigger: un DTO con constraint di sicurezza/integrità entra in un path senza copertura unit equivalente.
- `TD-cassa-resto-drawer` — trigger: cliente chiede riconciliazione cassetto/fondo cassa. Il resto contanti non è modellato.
- `TD-cassa-chiusura-giornaliera` — trigger: pilota chiede riepilogo fine giornata (Z-report). `cassa.chiusura.giornaliera` resta orfano.

**Chiusi questa sessione:** `TD-ci-apt-external-dep` (#192), `TD-tailwind-config-dup` (#189).

## Le lezioni della sessione (il filo comune)

**"Il verde dimostra meno di quanto sembra."** Quattro manifestazioni concrete:

1. La cassa sarebbe stata deployata read-only (403 su ogni pagamento) con CI e page-tour **verdi** — falliva con grazia. Presa dalla deploy-preflight.
2. Il `ValidationPipe` non valida i DTO in e2e — constraint verdi mai esercitati. Presa perché un test nuovo è fallito.
3. `report.operativo.visualizza` mancante su un ruolo materializzato pur avendolo il template — verificare **in DB, non nel seed**.
4. Il test single-flight passava su una race vinta, poi si è nascosto dietro un **job `success` con 1 flaky** (retry Playwright che maschera il primo tentativo). Regola operativa: **1 flaky non è verde; leggere la riga di riepilogo, non la conclusion.**

Corollario operativo: **la verifica empirica mirata batte il GATE**. Costruire le condizioni perché un check eserciti davvero il punto (utente Cameriere temporaneo + conti creati apposta, altrimenti la lista era vuota e il Badge non si renderizzava mai). E fare il **grep di chiusura sui residui E sulle assunzioni implicite**, non solo sui sentinel — `grep waitForURL.*dashboard` avrebbe trovato i 5 call-site di quiete prima del merge di #193. La domanda mancante: "chi altro assume che questa pagina sia ferma?".

**Altri principi rafforzati:**

- Diff dei valori CSS computati > screenshot per i cambi di token (deterministico, nessuna baseline binaria). Ha trovato un letterale citato in un commento che Tailwind trasformava in CSS reale.
- Riconcilia all'**invariante**, non cherry-pick (Super Admin = `ALL_PERMISSION_CODES`).
- Un presidio che dipende da una risorsa che non controlli (apt source, memoria dell'operatore) **cede in silenzio** appena quella cambia.
- Il contratto del seam (7×2) e il conteggio token (6/12) vengono dalla **misura** (diff del build, contrasto WCAG), non dall'ispezione a vista né dalla lista di scope.
- Togliere a un test la dipendenza dalla quiete (waiter espliciti) invece di inseguirla con segnali parziali: deterministico batte "ridotto".

## Prossimi passi

1. **P3 — vernice A su tutto il restaurant** (dashboard inclusa, uniforme). Estetica scelta: **A · Servizio** = sistema di base (le ore), **C · Turno** = dark/KDS, **B · Sala** = layer di brand food. Le 4 leggi del design system (ADR-0083) sono la checklist di review di ogni PR visiva. Seam per-tenant previsto-e-vuoto, trigger scritto.
2. **P4 — ritocco delle 12 primitive esistenti** (unica fase non isolabile: 79 file, 2 app), ultima, con baseline visual-regression come strumento.
3. **Deploy design + P2** (il prossimo deploy porta seam + P2 insieme; applicare rollback-tag come passo fisso e il check permessi Super Admin come GATE se `TD-deploy-perm-reconcile-gate` è meccanizzato).
4. **Note Spese** (5 PR specced, ri-validare la spec per drift prima di costruire), **GroqService extraction**, **AI-pilot food**, **Cassa pre-fiscale RT** (differito a cliente reale) — per il piano a lungo termine.

## Convenzioni operative (invariate)

- Merge = `gh pr merge --squash --delete-branch` **da terminale Code**, dopo "vai" esplicito di Nicolò. MAI da UI. (La riga-indice stale in MEMORY.md che diceva "da UI" è stata corretta questa sessione.)
- `gh pr create` e `gh pr merge` sono turni separati; non ripetere un comando rifiutato uguale.
- `git add` sempre selettivo, mai `-A`.
- STOP-gate: STOP 0 read-only → STOP 1 lockato → STOP 2 self-check con riga "impatto sull'altro verticale: verificato/N.A." per PR su superfici condivise.
- HANDOFF e PROGRESS sono **due PR docs separate** (log vs stato di chiusura), via PR docs dedicata (`docs/...`, commit `docs(...): ...`, PR + CI verde + squash — NO push diretto, il pre-push hook ADR-0004 lo blocca).
- L'header _Ultimo aggiornamento / Fase corrente_ di PROGRESS è stale da giugno per convenzione: allinearlo è una decisione a sé, non un effetto collaterale di altre PR.

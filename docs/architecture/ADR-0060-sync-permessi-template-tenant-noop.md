# ADR-0060 — Sync permessi template→tenant: no-op verificato, debito deferito a verticale first-class

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** Task #1 dei task aperti 2026-06-30 (causa-radice del bug "tavoli 403")
- **Predecessor:** [ADR-0010](./ADR-0010-tenant-bootstrap.md) (bootstrap tenant + clone template), [ADR-0058](./ADR-0058-tavoli-mappa-sala-f2.md) (F2 Tavoli — il cui 403 ha motivato il task), [ADR-0059](./ADR-0059-smoke-funzionale-per-verticale-per-ruolo.md) (smoke che ha confermato il fix tavoli a runtime)
- **Branch:** `chore/sync-permessi-noop-adr`

## Context

Il bug "tavoli 403" (Super Admin senza `tavoli.visualizza` nel DB prod → 403 sulla pagina `mappa`) era stato tappato da un re-seed additivo. L'ipotesi era che il buco fosse più ampio: altri permessi mancanti su altri ruoli/tenant, perché la clonazione template→ruolo avviene **one-shot** alla nascita del tenant ([tenants.service.ts](../../packages/auth/src/tenants/tenants.service.ts)) e non esiste un meccanismo che ri-propaghi i cambiamenti dei template ai ruoli già materializzati. Il task #1 doveva costruire questo sync, additivo e idempotente, generalizzato a ogni tenant e ogni ruolo.

Prima di costruirlo è stato fatto uno STOP 0 ricognitivo (read-only) sul DB prod per **misurare empiricamente il delta**, invece di assumerlo.

## Decision

**Non si costruisce un sync permessi correttivo ora.** Lo STOP 0 ha accertato che il delta dati è **zero**: non c'è alcun consumer reale (Pattern 43 — niente meccanismo senza consumer). Il task si chiude come **no-op verificato**, documentando il meccanismo di idempotenza accertato (per quando servirà) e registrando il debito **vero** — strutturale e forward-looking — che matura con la nozione di verticale first-class (task #4).

### Evidenza empirica (STOP 0, `postgres` superuser, solo SELECT)

Delta consolidato — per ogni ruolo materializzato × tenant, permessi del template corrispondente (join per `name`) mancanti / in eccesso:

| tenant      | ruolo         | n_perms ruolo | n_perms template | mancanti | eccesso |
| ----------- | ------------- | ------------- | ---------------- | -------- | ------- |
| demo        | Super Admin   | 56            | 56               | **0**    | 0       |
| acme        | Super Admin   | 56            | 56               | **0**    | 0       |
| oneplatform | Super Admin   | 56            | 56               | **0**    | 0       |
| studio-demo | Super Admin   | 56            | 56               | **0**    | 0       |
| studio-demo | Collaboratore | 17            | 17               | **0**    | 0       |
| studio-demo | Cliente       | 4             | 4                | **0**    | 0       |

- **0 permessi mancanti, 0 eccessi, 0 ruoli custom (senza template), 0 permessi orfani.** `tavoli.gestisci`/`tavoli.visualizza` già presenti su tutti i Super Admin → il 403 è chiuso a livello dati.
- Ancore: **60 permessi** in catalogo, **11 system_role_templates** (tutti `isDefault=true`), **4 tenant** (solo well-known), **6 ruoli materializzati**, **245 role_permissions**.
- Il re-seed additivo ha già riallineato i well-known; **nessun tenant creato via API esiste** (l'unico, `verifica-41554`, rimosso nel cleanup ADR-precedente) → **nessun drift attivo**.

### Meccanismo di idempotenza accertato (per quando servirà)

Se/quando il sync diventerà necessario (vedi Trigger), questi sono i fatti tecnici già verificati:

- **Upsert additivo nativo:** `role_permissions` ha PK `(role_id, permission_id)` → `INSERT ... ON CONFLICT DO NOTHING` è idempotente e non rimuove grant esistenti (additivo per costruzione).
- **Percorso di scrittura:** `roles` è **RLS FORCE**; `role_permissions` non ha RLS propria (isolation indiretta via `roles`). Un sync che enumera i ruoli di **tutti** i tenant deve girare come `DIRECT_URL`/`postgres` superuser (l'app role `gestionale_app` è filtrato cross-tenant) — stesso percorso del tool ops `purge-tenant`.
- **Super Admin è enumerato esplicito** (56 righe in `role_permissions`, non un wildcard/flag): un sync futuro **deve** includerlo esplicitamente — è esattamente il motivo per cui era esposto al buco tavoli.
- **Chiave di join template↔ruolo = `name`** (i ruoli non portano `templateId`/`code`): vedi TD-role-template-key.

### Trigger di rivisitazione

I TD sotto diventano azionabili **insieme** quando si verifica uno di:

1. nasce il **primo tenant via API bootstrap** (non via seed) → comincia il drift reale;
2. si introduce la **nozione di verticale first-class** (task #4), che dà la dimensione mancante per curare ruoli/template per-verticale nei dati anziché nel seed imperativo.

## Tech debt registrati (maturano insieme, trigger comune = #4 / primo tenant API)

- **TD-perm-propagation** — nessun meccanismo auto/idempotente template→ruoli materializzati; oggi ci si affida al re-seed manuale, che copre **solo** i tenant well-known gestiti dal seed. Delta attuale 0 → non urgente. Diventa azionabile col primo tenant API o un cambio di template post-bootstrap.
- ✅ **TD-bootstrap-verticale** — **CHIUSO per costruzione il 2026-09-01** (PR4 della rimozione del verticale restaurant). Era: [tenants.service.ts](../../packages/auth/src/tenants/tenants.service.ts) clona **tutti** i template `isDefault=true` → un tenant creato via API riceverebbe i ruoli del verticale sbagliato (es. un tenant restaurant otterrebbe Socio/Praticante/Segreteria). Rimosso il verticale food, i template scendono da 11 a 7 e sono tutti dello studio: **non esiste più un verticale sbagliato da cui ereditare**.

  ⚠️ **Chiuso non vuol dire risolto.** La causa-radice — assenza di una dimensione `verticale` nei dati, con la curatela che vive solo nel seed imperativo — è intatta: è il _sintomo_ ad essere decaduto insieme al secondo verticale. Se un secondo verticale tornasse, questo TD torna con lui, e va riaperto invece che riscoperto. Lo stesso vale per la sua dipendenza **TD-rbac-tavolo-write-subset** ([ADR-0058](./ADR-0058-tavoli-mappa-sala-f2.md)), che aveva come trigger «primo ruolo non-admin su un tenant restaurant reale»: il tenant, il ruolo e l'endpoint `PATCH /tables/:id` non esistono più.

- **TD-role-template-key** — i ruoli materializzati non portano `templateId`/`code`; l'unico match template↔ruolo è `name` (stringa libera, rinominabile). Rende fragile sia il sync (TD-perm-propagation) sia il fix del bootstrap (TD-bootstrap-verticale). Prerequisito tecnico: un riferimento stabile (`templateId`/`code`) sui ruoli system.

## Consequences

- **Positive:** nessun meccanismo costruito senza consumer; il buco presunto è stato **misurato** (non assunto) e accertato chiuso; il debito reale è isolato, datato e legato al suo trigger; i commenti stale (conteggi template/permessi) sono allineati alla realtà.
- **Negative / rischio residuo:** il drift resta possibile in futuro (tenant API / cambi template post-bootstrap); finché i TD non sono chiusi, la prevenzione è affidata alla disciplina del re-seed. Accettabile dato delta=0 e assenza di tenant API.
- **GATE ADR-0052:** **N/A** — nessun cambio FE/BE/DB/migration. Solo correzione commenti (no cambio logica) + documentazione.

## Links

- STOP 0 (evidenza grezza A→E) — sessione 2026-07-01.
- [ADR-0010](./ADR-0010-tenant-bootstrap.md), [ADR-0058](./ADR-0058-tavoli-mappa-sala-f2.md), [ADR-0059](./ADR-0059-smoke-funzionale-per-verticale-per-ruolo.md).

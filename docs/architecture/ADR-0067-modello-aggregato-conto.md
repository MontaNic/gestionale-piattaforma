# ADR-0067 — Modello aggregato Conto (blocco COMANDE): 2 livelli, snapshot pricing, Comanda differita

**Status:** Accepted
**Date:** 2026-07-01
**Related:** ADR-0009 (RLS reali), ADR-0021 (soft-delete RLS-aware), ADR-0019 (F1 Menu domain), ADR-0058 (F2 Tavoli), ADR-0066 (sync permessi differito), ADR-0063 (tiering STOP-gate)

## Context

Il verticale ristorazione entra nel blocco operativo **COMANDE**, primo sotto-blocco della sequenza fissata **Comande → KDS → Cassa pre-fiscale → RT differito**. Lo STOP 0 read-only ha fotografato la base: esistono già `Article` (con listini multipli via `ArticlePrice`/`PriceList`), `Tavolo` (F2, tenant-scoped), `MenuCategory`, l'enum `Channel` (cassa/menu_online/asporto/delivery) e `PrintDepartment` (cucina/pizzeria/bar), più `AuditLog` e i 5 permessi `comande.*` già seedati ma **orfani** (0 enforcement). **Non esiste** alcuna entità conto/ordine aperto — è il cuore mancante.

Questa PR (**PR-1**) costruisce **solo le fondamenta dati**: aggregato + migration + RLS + test di isolamento. Endpoint operativi e enforcement dei `comande.*` → **PR-2**; FE (pagina comande) → **PR-3**. Tier **ALTO** (nuovo aggregato + migration su `schema.prisma` condiviso + RLS tenant), STOP-gate pieno (ADR-0063).

## Decision

### Aggregato a 2 livelli: `Conto` (testata) → `ContoRiga` (riga)

- `ContoRiga.contoId` **non-null**: le righe sono ancorate al conto.
- La **Comanda** (livello KDS, invio-in-cucina di un sottoinsieme di righe) è **differita**. Si aggancerà in modo **additivo** con `comandaId` **nullable** sulla riga quando il blocco KDS arriverà. PR-1 **non predispone** alcun campo per essa (YAGNI / no forward-build senza consumer).

### `Conto` tenant-scoped, nessuna FK Tavolo→Sede ora

- `tavoloId` FK a `Tavolo` **nullable** (asporto/delivery non hanno tavolo), `onDelete: SetNull`.
- Il conto è **tenant-scoped come `Tavolo`** (ADR-0058), non sede-scoped. `Tavolo` stesso non ha FK a `Sede`. Un futuro `sedeId` multi-sede sarà **migration additiva nullable con trigger** — non aggiunto ora.
- `channel` riusa l'enum food esistente `Channel` (binding canale↔pricing). La **coerenza `tavoloId`↔`channel`** (es. sala ⇒ tavolo obbligatorio) è **enforcement applicativo → PR-2**; PR-1 fissa solo la forma dati.
- `stato` = enum **`StatoConto {aperto, chiuso, annullato}`** default `aperto`; `coperti` Int nullable (asporto non ne ha); `apertoIl` default now, `chiusoIl` nullable.

### `ContoRiga` con snapshot pricing (DP-C)

La riga **congela** i valori al momento dell'ordine, non riferimenti live:

- `nomeArticolo` (String), `prezzoUnitario` (Decimal(10,2)), `reparto` (`PrintDepartment`) sono **colonne indipendenti**, popolate dallo snapshot di `Article` all'inserimento.
- Verificato empiricamente (test 4): modificando l'`Article` sorgente (nome/prezzo/reparto) la riga **non cambia**. Robustezza storica (articolo rinominato/soft-deleted/riprezzato) + prepara il KDS (`reparto`) a costo zero.
- FK `articleId` `onDelete: Restrict` (l'articolo è comunque soft-deleted, lo snapshot regge da solo); `contoId` `onDelete: Cascade`.

### Naming italiano

`Conto` / `ContoRiga` / `StatoConto`, coerente con `Tavolo` e i permessi `comande.*`. Tabelle `conti` / `conti_righe`, enum `stato_conto`.

### Campi audit: `createdBy` ASSENTE — coerenza col pattern food

Verifica empirica: **nessun model food** (`Menu`/`Article`/`Tavolo`) ha `createdBy`; l'unico in tutto lo schema è `Documento` (dominio accountant, con relazione `User`). L'aggregato Conto usa quindi **`createdAt`/`updatedAt`/`deletedAt`** senza `createdBy`. Aggiungerlo ora introdurrebbe una FK a `User` che il resto del food non ha, per un consumer che in PR-1 non esiste (YAGNI + coerenza col verticale). Se in futuro servirà tracciare chi apre il conto, è una **migration additiva nullable** (trigger noto, costo basso). _(Deviazione consapevole dal prompt STOP 1, che citava `createdBy` a memoria; applicato "verifica il pattern, non inventare".)_

### RLS FORCE su ENTRAMBI i model + soft-delete

Vincolo architetturale (ADR-0009): `ENABLE` + **`FORCE ROW LEVEL SECURITY`** su `conti` e `conti_righe`, policy `<table>_tenant_isolation` (super-admin bypass OR `tenant_id = app.tenant_id`), pattern replicato 1:1 da `tavoli`/`menu`. Grant su nuove tabelle ereditato via `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`. UUID v7 app-side, `@map` snake_case, soft-delete via `deletedAt`.

L'isolamento è **esercitato**, non solo scritto: spec `conti-rls-isolation.e2e-spec.ts` boota un client come ruolo `gestionale_app` (NOSUPERUSER/NOBYPASSRLS) e in 8 casi tenta la violazione cross-tenant e fallisce chiuso (read vuoto, update→P2025 con vittima intatta, insert `tenantId` altrui bloccato da WITH CHECK).

### Soft-delete via service → PR-2 (forward dichiarato, non debito nuovo)

Sotto RLS non-superuser, `prisma.conto.delete()` su plain client dà **P2025**: il rewrite `delete→update` della `softDeleteExtension` gira su un delegate **fuori** dalla tx RLS per-operazione — **stesso caveat già documentato in [ADR-0021](ADR-0021-soft-delete-rls-tx-escape-fix.md)**. Il path corretto — `withTenantContextAtomicTx` + `tx.update({ deletedAt })` — vive nel **service**, che è **PR-2**. Il test PR-1 valorizza quindi `deletedAt` via `update()` (la colonna che il service scriverà) e verifica la **proprietà di invisibilità** del soft-delete (ciò che chiede CHECK-BE-2), non il meccanismo del service. È un **forward dichiarato con rimando ad ADR-0021**, non un TD nuovo.

## Consequences

- Fondamenta dati delle comande pronte: PR-2 può costruire modulo `restaurant-api` + endpoint + enforcement dei 5 `comande.*` sopra un aggregato già isolato e testato.
- Migration generata/applicata **solo su DB throwaway** (Postgres 16, porta 55432, volume effimero, `DATABASE_URL` inline); `.env` prod intoccato, container prod invariati pre/post. Applicazione a prod solo al deploy, fuori da questa PR.
- PR-1 **non tocca permessi**: catalogo resta **60**.
- Punti forward espliciti tracciati (riattivabili con contesto già scritto): (a) **Comanda additiva** (`comandaId` nullable, blocco KDS); (b) **`sedeId` multi-sede** (migration additiva nullable con trigger); (c) **coerenza `tavoloId`↔`channel`** (enforcement service, PR-2); (d) **soft-delete via service** (PR-2, rimando ADR-0021); (e) **`createdBy`** (additivo nullable se un consumer lo richiederà).

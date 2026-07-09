# ADR-0058 — F2 Tavoli / Mappa sala (schema + backend + mappa drag-drop)

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0019](./ADR-0019-f1-menu-crud-schema.md) (pattern modulo CRUD F1 + RLS reference), [ADR-0023](./ADR-0023-td-bz-partial-unique-soft-delete.md) (partial-unique soft-delete-aware TD-BZ), [ADR-0027](./ADR-0027-composizione-core-condiviso.md) (confine CORE/DOMINIO, estrazione core §D5), [ADR-0052](./ADR-0052-gate-checklist.md) (GATE checklist FE/BE/DB), [ADR-0017](./ADR-0017-rbac-permissions-guard.md) (RBAC Guard + audit convention)

## ✅ Status finale

**F2 Tavoli / Mappa sala — schema + backend CRUD + mappa visuale drag-drop completati.**

- Schema Prisma: 1 modello business `Tavolo` con coordinate `posX`/`posY` (Float) sotto il confine DOMINIO (banner ADR-0027 §D5).
- Migration `20260630120000_add_tavoli_models_f2_schema`: CREATE TABLE `tavoli` + index `tenant_id` + partial-unique soft-delete-aware `(tenant_id, numero) WHERE deleted_at IS NULL` + FK tenant `ON DELETE CASCADE` + RLS `ENABLE`/`FORCE` + policy `tavoli_tenant_isolation` (USING-only, branch super-admin, pattern menu 1:1).
- Backend NestJS: modulo `tables/` (controller + service + DTO + unit spec) → REST `/tables` CRUD gated.
- Seed: +2 permessi `tavoli.visualizza` / `tavoli.gestisci` (baseline array `58 → 60`); assegnazione ai ruoli risto reali.
- FE: `mappa/page.tsx` sostituisce `<PlaceholderPage>` con la mappa sala drag-drop (persistenza coordinate via PATCH on-drop, ottimistico + rollback) + elenco accessibile; namespace i18n `tavoli` it↔en in parità.
- E2E Testcontainers: 3 spec (CRUD + soft-delete invisibility, RBAC viewer/manager, cross-tenant 404).

**Primo dominio nuovo costruito sul core dopo l'estrazione (ADR-0027): valida il core su un secondo verticale-feature.** `mappa` era un placeholder nella shell restaurant.

## Context

La shell restaurant (ADR-0018) prevede 8 voci di navigazione, di cui `mappa` era un `<PlaceholderPage>`. Questa è la prima feature di dominio nuova interamente costruita sul core estratto (`packages/*`): ne valida la riusabilità (api-client, auth, db/RLS, ui, i18n) su un secondo verticale-feature dopo F1 Menu.

Scope-lock confermato dall'owner: **solo `Tavolo` + mappa visuale x/y · `tavoli.*` (2 verbi) · stato e `Sala` deferred.**

## Decisions

### D1 — Modello solo `Tavolo` con coordinate → mappa visuale drag-drop ora

`Tavolo` ha `numero` (etichetta), `capienza` (coperti) e `posX`/`posY` (Float, `@default(0)`: nuovo tavolo nasce all'origine, poi trascinabile). La **mappa visuale drag-drop** è il senso della feature e l'unico pattern FE nuovo da validare: **persistenza coordinate**. Il drag persiste via lo stesso `PATCH /tables/:id` (no endpoint position dedicato — YAGNI), debounce **on-drop**, stato ottimistico con rollback su errore.

### D2 — Permessi `tavoli.visualizza` / `tavoli.gestisci` (2 verbi)

Coerente coi plurali `comande.*` / `cassa.*` già seedati. `visualizza` per i GET, `gestisci` per POST/PATCH/DELETE. Baseline array `PERMISSIONS` `58 → 60`.

**Assegnazione ai ruoli risto — description-driven (non mirror letterale di `menu.visualizza`):** le `description` dei `ROLE_TEMPLATES` nel seed sono la fonte d'intento autorevole.

- `tavoli.gestisci` → **Direzione** (mirror di `menu.categoria.gestisci`).
- `tavoli.visualizza` → **Direzione, Cassiere, Cameriere** — le cui description citano i tavoli («Operatore POS: tavoli…», «…mappa tavoli»).
- **Cucina/Bar esclusa** pur avendo `menu.visualizza`: la sua description è _«KDS read-only + cambio stato comande. Nessuna altra azione.»_ La cucina non naviga la mappa sala; quando le comande arriveranno, il KDS conoscerà il tavolo via la relazione comanda→tavolo gated da `comande.*`, non da `tavoli.visualizza`.
- **Super Admin** + **Admin sede** ricevono entrambi i permessi automaticamente via `ALL_PERMISSION_CODES` (non-portale).

### D3 — `Sala`/`Zona` deferred → **TD-sala-forward**

Nessun consumer reale ora: la relazione 1:N è già provata da Menu→MenuCategory (zero validazione nuova). Aggiungere `Sala` ora sarebbe schema senza UI che lo consuma. Confine: finché non implementato, i tavoli vivono in un unico piano sala (la mappa). `Sala` arriverà col primo consumer reale (multi-sala / multi-piano).

### D4 — Stato tavolo (libero/occupato/riservato) deferred → **TD-tavolo-stato-forward**

Lo stato ha senso solo con un **ordine attivo**, e le comande non esistono ancora (S23+). Introdurre un enum stato ora significherebbe un campo che nessuna logica transiziona. `deletedAt` copre già il caso "fuori servizio". Confine: la mappa mostra i tavoli senza colore-stato finché le comande non esistono.

### D5 — Forma migration: partial-unique fuso nella creazione (greenfield)

A differenza del menu (full-index in creazione, poi retrofit a partial in `td_bz`), `tavoli` è una tabella greenfield: il partial-unique soft-delete-aware nasce **direttamente** nella migration di creazione (`tavoli_tenant_numero_active_uq`), forma copiata 1:1 da `td_bz_partial_unique_soft_delete`. Nessun full-index da rimpiazzare. RLS vive **solo** nella migration raw (lo schema Prisma ha `@@index` + `@@map`, nessun marker RLS nel DSL — conforme ai modelli F1).

## Confini

Non si tocca StudioDesk (verticale accountant) né i core packages, salvo l'aggiunta del re-export del tipo `Tavolo` in `packages/db` (additivo, coerente con gli altri modelli). Nessuna astrazione di dominio prematura.

## Technical Debt registrati

- 🆕 **TD-sala-forward** — `Sala`/`Zona` (raggruppamento tavoli, multi-piano). **Confine:** unico piano sala finché non implementato. Severità BASSA, additivo (relazione già provata Menu→Category). Si attiva col primo consumer multi-sala.
- 🆕 **TD-tavolo-stato-forward** — stato tavolo (libero/occupato/riservato). **Confine:** mappa senza colore-stato. Dipende da Comande (S23+): lo stato deriva da un ordine attivo, gated `comande.*`. Severità BASSA, additivo.
- 🆕 **TD-rbac-tavolo-write-subset** — non è stato esercitato a runtime su un tenant reale se un ruolo con **sottoinsieme** di permessi (non-admin, privo di `tavoli.gestisci`) riceva il `403` corretto — o, viceversa, se un ruolo che _dovrebbe_ poter scrivere prenda un `403` **indebito** — dal `PermissionsGuard` sulla scrittura posizione tavolo (`PATCH /tables/:id`). È un check **RBAC**, non RLS (vedi nota sotto). FE-5 (2026-07-01, ADR-0063/0064) ha coperto l'**happy-path** con `direzione@demo.local` (ruolo non-super _con_ `tavoli.gestisci` → PATCH 200), ma su Postgres throwaway; il path negativo su un tenant reale resta aperto. **Trigger:** primo ruolo non-admin creato su un tenant restaurant reale. **Tier BASSO** (verifica runtime, nessuna modifica strutturale attesa). **Dipendenza esplicita:** si attiva insieme a **TD-bootstrap-verticale** — i ruoli clonano i template cross-verticale, quindi un ruolo restaurant reale porta con sé anche permessi accountant; i due vanno affrontati nella stessa sessione.

> **Nota RLS-vs-RBAC (chiarimento):** il valore `app.is_super_admin` che `rls.ts` passa a `SET LOCAL` è costante letterale `false` in ogni entrypoint del request-path JWT (`tenant-context.interceptor.ts:52`, `jwt.strategy.ts:58`, `permissions.guard.ts:102`, `tenant.middleware.ts:71`, `auth.service.ts:275`); `true` è prodotto solo server-side da `withSystemContext`/`withSuperAdminContext` (seed/bootstrap/script), mai dal flow JWT (ADR-0009 D3 #4 + S5). Quindi "Super Admin" è un concetto di **RBAC applicativo**, disaccoppiato dal bypass RLS: qualunque utente via JWT (Super Admin compreso, e già FE-5 con Direzione non-super) gira con RLS attiva e confinata al proprio tenant. L'**RLS** sulla scrittura tavolo è perciò già esercitata; il residuo non testato è puramente **RBAC** (il gating dei permessi), tracciato da `TD-rbac-tavolo-write-subset`.

## Consequences

- ✅ Il core (api-client, auth, db/RLS, ui, i18n) regge un secondo dominio-feature senza modifiche oltre il re-export tipo.
- ✅ Nuovo pattern FE validato: persistenza coordinate drag-drop ottimistica + rollback.
- ⚠️ Tre TD forward aperti (sala, stato, rbac-tavolo-write-subset) — tutti a severità bassa (additivi / verifica-runtime), non bloccanti.

# HANDOFF — gestionale-piattaforma

**Snapshot:** Main @ `a69fb09` (+1 commit `docs(handoff)` in arrivo via PR).
**Aggiornato:** 2026-07-01.
**Verticali:** entrambi deployati e pubblici — `studiodesk.cloud` (accountant), `food.studiodesk.cloud` (restaurant, demo temporaneo).

---

## PARTE A — STATO CORRENTE

### Sessione 2026-07-01 — catena dei 4 task del 2026-06-30 (tutti su main)

| #   | Task                                     | Esito                                                        | PR · ADR        |
| --- | ---------------------------------------- | ------------------------------------------------------------ | --------------- |
| #2  | Smoke funzionale per-verticale per-ruolo | **costruito**                                                | #142 · ADR-0059 |
| #3  | Cleanup tenant test + `purge-tenant` ops | **costruito**                                                | #143            |
| #1  | Sync permessi template→tenant            | **non costruito** — no-op misurato (delta=0) + 3 TD deferiti | #144 · ADR-0060 |
| #4  | Branding per-verticale build-time        | **costruito**                                                | #145 · ADR-0061 |

Filo metodologico: _verified, not promised_ applicato in positivo e in negativo. Due fix costruiti perché la misura diceva che servivano; due non costruiti perché misurati come non necessari, con il debito reale isolato e datato al suo trigger anziché tappato a intuito.

### Smoke funzionale (ADR-0059, #142)

Gate post-deploy read-only on-demand: `pnpm smoke` (`smoke:accountant` / `smoke:restaurant`). Login reale per-ruolo → tour di ogni pagina shell accessibile al ruolo → assert no 403/≥500/pageerror/crash, con guard read-only attivo (qualsiasi metodo mutante durante il tour = fail). Copertura Fase 1: restaurant 10/10 (Super Admin), accountant 32/32 (Super Admin + Collaboratore + Cliente). Fuori da CI (`testIgnore` + config `.smoke` dedicate). Principio: tour di un ruolo = pagine a cui ha legittimo accesso → ogni 403 nel tour è un bug per definizione. Limiti noti: 3/11 ruoli coperti (solo quelli con utenti seedati); `platform/tenants` non coperta (Fase 2 oneplatform); 2 detail comunicazioni escluse (mutate-on-view → TD).

### Cleanup + tooling ops (#143)

DB prod ripulito: **4 tenant well-known** (`demo`/`acme`/`studio-demo`/`oneplatform`), zero residui di test (rimossi `verifica-41554`, `rls-a`, `rls-b` via hard-delete transazionale CASCADE, 22 righe). `purge-tenant` versionato in `packages/db` (`pnpm --filter @gestionale/db purge-tenant --slug <x>`, dry-run default, `--execute`): guard-rail blocklist well-known categorica, match esatto slug/id, transazione con verifica pre-commit, connessione `DIRECT_URL` (superuser, bypassa RLS FORCE). Prima pietra del tooling ops in `packages/db`.

### Sync permessi — no-op verificato (ADR-0060, #144)

STOP 0 ha **misurato** delta = 0 su tutti i 6 ruoli materializzati × 4 tenant (0 mancanti, 0 eccessi, 0 ruoli custom, 0 orfani): il 403 tavoli era già chiuso dal re-seed. Nessun meccanismo costruito (nessun consumer reale). Allineati i conteggi stale nei commenti (`tenants.service.ts`, `seed.ts`, e2e rbac → 11 template / 60 permessi / 249 mapping). Meccanismo di idempotenza accertato per quando servirà: `role_permissions` PK `(role_id, permission_id)` → upsert additivo; scrittura via `DIRECT_URL`; Super Admin enumerato esplicito (va incluso in un sync futuro). Trigger di rivisitazione: primo tenant via API / nozione di verticale first-class.

### Branding per-verticale (ADR-0061, #145)

Build-time, pattern riusabile. Tipo `BrandConfig` (type-only) in `packages/ui` + istanza per-app disaccoppiata (`StudioDesk` / `FoodDesk`). Aggiungere un verticale = un solo brand object (login/metadata/shell/asset-slot ereditati). Asset placeholder (wordmark `currentColor` light+dark, favicon-tile) sostituibili nello stesso path. 8 punti cablati simmetrici (metadata, login→`brand.Logo`+title i18n, Sidebar, Topbar). Login restaurant portato a next-intl (parità i18n con accountant). Verticale **strutturale per scelta** — il verticale-dato (`tenants.vertical`) è deferito al trigger dei 3 TD di ADR-0060, non aggiunto "già che ci siamo". GATE 6/6. **`FoodDesk` è segnaposto consapevole** — sostituibile col suo giro PR quando il nome food sarà deciso.

### Hotfix cambio lingua prod (ADR-0062, #146)

Bug segnalato: da collaboratore su StudioDesk il cambio lingua IT→EN non faceva nulla. Diagnosi empirica: sintomo fuorviante → **bug generale prod-only, entrambi i verticali**, non ruolo-specifico. Causa: la route Next `POST /api/set-locale` era ingoiata da Caddy `handle /api/*` → inoltrata al backend NestJS (`/api/v1`) → 404 → cookie `NEXT_LOCALE` mai scritto. Fix (asse B): route spostata fuori dal namespace backend (`/api/set-locale` → `/set-locale`) in entrambe le app, client `fetch` aggiornato, `set-locale$` escluso dal matcher middleware. Contratto reso **eseguibile** (ADR-0062): guard CI `scripts/check-no-api-next-routes.sh` fallisce su qualsiasi `apps/*/src/app/api/**/route.ts`, con messaggio che spiega il perché — auto-enforce del same-origin di ADR-0042. Regression guard e2e `locale-switcher.spec.ts` (restaurant). Deployato (rebuild web ×2, `a69fb09`) e verificato in prod su entrambi i domini: nuovo path 200+cookie, vecchio path 404, UI IT→EN persistente al refresh. **Risolto end-to-end.**

### Contesto stabile (invariato)

- **StudioDesk (accountant):** Onda 3+4 complete (TD-tariffario #127/ADR-0055, i18n-cumulativo #129, voceId-FE #132, i18n-zod #134; AI draft comunicazioni #136/ADR-0056 + insight margine #139/ADR-0057). Live su `studiodesk.cloud`.
- **Restaurant:** riattivato (ADR-0058). F1 Menu completo, F2 Tavoli/Mappa (#138). Deployato (#141) su `food.studiodesk.cloud` (demo temporaneo). Prossimi blocchi: comande/cassa/KDS.
- **Permessi:** 60 nel catalogo su main. Parità ruoli↔template (delta 0).
- **Deploy/Caddy:** config reale in `/home/deploy/projects/gestionale/infra/caddy/conf` (bind ro), NON il Caddyfile placeholder in root. Verifica sempre dalla config montata nel container. Schema Prisma unico condiviso tra verticali, un solo DB.

### Tech debt aperti

**Invariati (pre-sessione, riconciliati col registry live):** TD-BV · TD-CB · TD-PATCH-null-FK · TD-blocklist-drift · `web` external one-time · TD-documenti-tipo-codice · TD-utente-enum-forward · TD-storage-gc · TD-moduleResolution-node10 · TD-circolari-utente-forward · TD-portale-com-allegati · TD-portale-com-apertura · TD-portale-circolari-html · TD-immagine-api · TD-sala-forward · TD-tavolo-stato-forward (restaurant, ADR-0058) · TD-no-error-boundary · TD-sidebar-permission-filter · TD-comunicazioni-mutate-on-view

**Nuovi (2026-07-01, ADR-0060 — maturano insieme alla nozione di verticale first-class):**

- **TD-perm-propagation** — nessuna propagazione idempotente template→ruoli materializzati; oggi solo re-seed manuale, copre solo i tenant well-known. Delta attuale 0 → non urgente.
- **TD-bootstrap-verticale** — `tenants.service.ts` clona tutti gli 11 template `isDefault` → un tenant creato via API riceverebbe ruoli del verticale sbagliato. Latente: nessun tenant via API esiste. Causa-radice: assenza di dimensione `verticale` nei dati.
- **TD-role-template-key** — i ruoli materializzati non portano `templateId`/`code`; match solo per `name` (stringa libera). Prerequisito tecnico di entrambi i sopra.

### Residui aperti

- Verifica runtime manuale FE mappa drag-drop #138 come non-superuser (drag-persist su Testcontainers ephemeral, FE-5): lo smoke #142 copre ora il _caricamento_ della pagina mappa come Super Admin, non la persistenza del drag — quella resta da verificare formalmente.

_(Il bug cambio lingua prod, inizialmente sospetto residuo, è stato trovato e risolto in questa sessione — vedi Hotfix ADR-0062/#146. Non è un residuo aperto.)_

---

## PARTE B — SULL'ORIZZONTE

### Prossimi fronti (datati al loro trigger)

- **Verticale-dato (`tenants.vertical`)** — quando nasce il primo tenant via API. Paga TD-bootstrap-verticale + TD-perm-propagation; richiede anche TD-role-template-key (chiave stabile sui ruoli). È il momento in cui la curatela verticale passa dal seed imperativo ai dati.
- **Nome food reale** — `FoodDesk` → brand definitivo (1 riga `productName`); + eventuale migrazione a dominio-brand proprio (`foodesk.cloud` o simile) quando il food avrà adesione. `food.studiodesk.cloud` è demo sotto il brand commercialisti, non l'indirizzo finale.

### Blocco restaurant: comande / cassa / KDS

Discovery da Cassa in Cloud (TeamSystem) — decisioni di modellazione **a monte**, costose da retrofittare:

- **Coperti sul conto/tavolo** — unità di tutti i KPI sala; se non tracciati dal giorno 1, lo storico è irrecuperabile.
- **Ciclo di vita del Conto con timestamp** (apertura→comande→chiusura) — abilita turnover tavolo, durata servizio, incasso/tavolo. F2 ha il `Tavolo`; manca l'entità `Conto`.
- **Modalità di vendita come dimensione di prezzo** (sala/asporto/…) — tocca il modello prezzo del Menu F1 (oggi prezzo scalare).
- **Reparto ≠ Categoria** — categoria merceologica (menu/UX) vs reparto fiscale (IVA, routing KDS).
- ⚠️ **Nodo fiscale**: cassa gestionale-pre-fiscale (documento via RT esterno) **vs** cassa fiscale (integrazione RT/corrispettivi telematici). Decisione di scope da verbalizzare prima della prima riga. Raccomandazione: gestionale-pre-fiscale per i primi blocchi, fiscalità come blocco separato.

### Roadmap più lontana

Portal accountant Onda 5+ (upload, email notifications, accettazione preventivi online); Public API versionata (per-tenant keys, OpenAPI); theme switching per-tenant (deferito a richiesta reale); subdomain routing `[slug].studiodesk.cloud`; layer `sa.<verticale>` superadmin (tenant mgmt, billing).

---

_HANDOFF completo. Nessun lavoro in sospeso da questa sessione oltre ai residui sopra elencati._

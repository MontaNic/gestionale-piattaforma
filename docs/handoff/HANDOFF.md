# HANDOFF — Gestionale Piattaforma

**Ultimo aggiornamento:** 2026-07-15 · fine sessione
**Snapshot:** Main @ `167cb3d` (+1 commit `docs(handoff)` in arrivo via questa PR)

---

## PARTE A — Stato

### Deploy reale — VERIFICATO su docker/DB (non a memoria)

Blocco verificato container per container il 2026-07-15 (image ID, marker nel bundle in esecuzione, count migration in prod). **La riga precedente «comande esiste solo a livello codice/DB-schema, non ancora deployato» era FALSA ed è stata rimossa**: ha fatto perdere un'ora a inizio sessione. Comande / KDS / vat / storno / portata sono **tutti in produzione**.

**Restaurant — allineato a `167cb3d`:**

- `restaurant-web` (`1b912b72c4e8`) e `restaurant-api` (`959dd4ea2474`), build **2026-07-14**, tag `portata-167cb3d` + `latest`.
- Marker verificati nel bundle in esecuzione: web → `stornoInviata` + `portata` presenti; api → endpoint `stornaRigaInviata` mappato, prisma-client con enum `Portata`.
- Live su `food.studiodesk.cloud` (demo/temporaneo; brand finale su dominio dedicato).

**Accountant — riqualificato (NON fermo al cutover):**

- `accountant-api` (`a8fa5fc80404`) e `accountant-web` (`0860539521f5`), build **2026-07-10 12:30**.
- È stato **ridistribuito il 10/07 per shippare #160** (auth-refresh single-flight, che tocca _entrambi_ i verticali) — verificato: il bundle in esecuzione contiene la logica single-flight (`refreshPromise`). Il timestamp cade **dopo #160 (09/07 18:39) e prima di #161 vat (10/07 17:36)** → gira su **~main@10/07 (post-#160, pre-#161)**, non su codice pre-cutover.
- Nessuna PR _accountant-app_ è entrata dopo #160 (le 12 PR della finestra sono restaurant/shared) → funzionalmente fermo a #160, ma su immagine 10/07 con i `packages/*` di quel momento. Live su `studiodesk.cloud` + `*.studiodesk.cloud`.

**DB:** schema Prisma unico, un solo DB `gestionale`. Prod = **32 migration** applicate, ultima `add_portata`. Allineato a main. Caddy reale bind-mounted da `infra/caddy/conf/Caddyfile`; reload zero-downtime, mai restart.

### Finestra dall'ultimo HANDOFF

L'HANDOFF precedente era **main @ `39632ae` (#152, 2026-07-01)** — non recente come sembrava. Da allora sono entrate **12 PR (#154→#165)**, non 7. Una riga ciascuna (dettaglio nei rispettivi ADR e in PROGRESS):

| PR   | oggetto                                           |
| ---- | ------------------------------------------------- |
| #154 | comande FE PR-1 core + filtro GET /conti          |
| #155 | integrazione TAVOLI↔COMANDE (ADR-0068)            |
| #156 | KDS PR-1 — attivazione layer Comanda (ADR-0069)   |
| #157 | KDS PR-2 — vista conto con invio comande + note   |
| #158 | fix trim/empty→null note riga conto               |
| #159 | docs TD-rbac-tavolo-write-subset (ADR-0058)       |
| #160 | auth-refresh single-flight (entrambi i verticali) |
| #161 | prezzi lordi + snapshot vatPercent (ADR-0070)     |
| #162 | warning coperti oltre capienza tavolo             |
| #163 | storno riga inviata                               |
| #164 | docs TD-ci-e2e-testcontainers-be (ADR-0071)       |
| #165 | portata/corso su Article + snapshot ContoRiga     |

PROGRESS.md copriva solo fino a #154 + le due registrazioni docs-only (#159/#164): il blocco KDS/vat/storno/portata è stato aggiunto in questa sessione (sync sintetico, una riga per feature).

### Permessi

Catalogo = **60** (invariato in tutta la finestra: nessuna delle 12 PR aggiunge permessi; lo storno riusa `comande.elimina`). **Aggiornamento vs HANDOFF precedente:** `comande.stato.cambia` **non è più orfano** — il consumer è arrivato con KDS PR-1 (#156, `comande.controller.ts:51`).

### Rollback point (10 tag vivi, nessuno dangling)

| tag                                 | image ID     |
| ----------------------------------- | ------------ |
| restaurant-web:rollback-pre-portata | 9d55d4122c8e |
| restaurant-api:rollback-pre-portata | e8ac2fa4d158 |
| restaurant-web:rollback-pre-storno  | 22130ce0346a |
| restaurant-api:rollback-pre-storno  | a9691ab1a772 |
| restaurant-web:rollback-pre-coperti | 5aa7c6f6e6ba |
| restaurant-api:rollback-pre-vat     | 3f11865f3a38 |
| restaurant-web:rollback-20260630    | d90a39faf3fd |
| restaurant-api:rollback-20260630    | b72c34eda625 |
| accountant-web:rollback-20260630    | c6e895ed135c |
| accountant-api:rollback-20260630    | f28c12ba151b |

### Presidi infrastrutturali pendenti — il filo di questa sessione

**Tesi: i presidi che dipendono dalla memoria dell'operatore falliscono. Vanno nel meccanismo.** Quattro volte oggi, lo stesso tema:

1. **`TD-dev-env-punta-prod` — ✅ ESTINTO (Sub-A + Sub-B + Sub-2).** Aveva quasi prodotto un incidente — i **dev server stavano per puntare a produzione** (`.env` dev → DB prod). Chiuso **nel meccanismo**: guard (Sub-A) + ambiente dev isolato dev-by-default (Sub-B) + verifica full-stack Sub-2. **Nessun residuo.**
   - **Sub-A (guard anti-prod-da-host) — MERGED** (#168, main @ `28d2b81`). Guard `assertSafeDbTarget(url, ctx)` (funzione pura, 9 test) wired in `createPrismaClient()` + `purge-tenant`: processo Node da host verso `127.0.0.1:5432/gestionale` con `NODE_ENV`≠production e senza `ALLOW_PROD_DB_ACCESS=1` **aborta prima di ogni query**. Gap noto → `TD-prisma-studio-prod-unguarded` (§TD).
   - **Sub-B (dev env isolato) — su branch `feat/dev-db-isolated`** (PR aperta). `docker-compose.devdb.yml` standalone (`gestionale-devdb`, porta 55432, volume/rete dedicati, creds dev ≠ prod) + `.env.devdb` + env injection sui `dev` delle 2 API → **dev-by-default** senza toccare `.env` root. Script `devdb:*` + `verify:guard-runtime`. GATE: setup idempotente (32 migr + 4 tenant) + login HTTP reale `studio-demo` contro dev DB. **2 discovery a runtime** (dettaglio PROGRESS [2026-07-23] + [ADR-0072](../architecture/ADR-0072-dev-db-isolated-and-init-conventions.md)): **(a)** l'init app-role era rotto (`:'pw'` dentro `DO $$` non interpolato) → `fix(infra)` interpolazione fuori dal DO block + fail-loud (ripara anche il bootstrap fresco prod, running non impattato); **(b)** il guard Sub-A era **inerte sull'host** perché il `dist` di `packages/db` era stale (pre-Sub-A) — i dev server importano il dist, non il src → rebuild lo riattiva; `verify:guard-runtime` check[0] cattura la regressione.
   - **Sub-2 — ✅ VERIFICATO (2026-07-23).** Verifica full-stack dei 5 path blob/multipart accountant contro BE reale (dev DB 55432, RLS fedele): eseguito il **codice REALE FE** (`apiGetBlob`/`apiPostMultipart` + single-flight reale `authOptions`/`refreshAccessToken`, via `tsx` con shim `window`/`localStorage`) con access token invalidato client-side + refresh valido. **5/5 path + single-flight PASS**: ogni path → **una sola** `/auth/refresh` → retry col nuovo token → 200/201; download byte-identici; upload persistiti in dev DB; 2 download concorrenti → 1 refresh (coalescing sotto latenza reale). Nessun path in cui il BE reale rifiuti il token refreshato. Chiude anche `TD-blob-download-no-refresh` end-to-end (oltre a Sub-1 route-mocked + unit). Dettaglio in PROGRESS [2026-07-23].
2. **`TD-ci-e2e-testcontainers-be` (ADR-0071) — Fase 1 ✅ (2026-07-23), Fase 2 residua.** **Fase 1 fatta** (fronte fedeltà-RLS, ex-`TD-CB`): nuovo job CI `e2e-rls-domain` (ubuntu-latest, Testcontainers dedicati) esegue i 3 spec che asseriscono l'isolamento tenant **DB-level come `gestionale_app`** (`conti`/`comande-rls-isolation` + `soft-delete-rls`) → una regressione di policy RLS su comande/conti rompe la CI. Selezione esplicita (`test:e2e:rls`, esattamente 3 file), fixture invariate (restano superuser), `toAppRoleUrl` hardened (pw da env). Prova di efficacia eseguita (bypass RLS → 2 spec rossi → ripristino verde). **Discovery:** `conti-rls-isolation` era bit-rotted (`vatPercent` mancante dal #161) → invisibile perché fuori CI = tesi del TD. **Fase 2 residua** = copertura comportamentale completa restaurant-api (13 spec) in CI; **trigger = `globalSetup` Vitest con container condiviso** (oggi per-file = costo). **Boundary:** `TD-ci-e2e-accountant-api` — porzione **RLS ora GATATA** (2026-07-23, PR-0 Note Spese): job gemello `e2e-rls-domain-accountant` esegue `rls-isolation.e2e-spec.ts` (10 test, anagrafica) come `gestionale_app`; prova di efficacia via break policy `preventivi_voci` (S-prev-4 rosso). Restano le ~17 spec **comportamentali** accountant fuori CI (stesso trigger `globalSetup`); bit-rot `report-margine` (200 vs 201) registrata lì. Dettaglio ADR-0071 Update + PROGRESS [2026-07-23].
   - **`TD-ci-e2e-accountant-web-fe` — ✅ CHIUSO (2026-07-23).** Job additivo `e2e-accountant-web-blob` esegue `blob-auth-refresh.spec.ts` (route-mocked, `next dev` :3013, no BE/DB) in CI. Escluso `page-tour.spec.ts` (infra full-stack).
3. **Termometro deploy.** Oggi «cosa gira in prod» è stato ricostruito a mano (image ID + marker nel bundle + count migration). Serve un check che dica quale SHA gira **senza affidarsi alle note versioned** (che oggi mentivano). Nel meccanismo, non nella memoria.
4. **Tag-rollback-obbligatorio.** Il pattern «tagga `:rollback-pre-<feature>` PRIMA del build» oggi ha tenuto (10 tag sani), ma dipende dalla disciplina dell'operatore. Renderlo **step dello script di deploy**, non promemoria.

Comun denominatore: ognuno ha una versione «meccanismo» che elimina la dipendenza dalla memoria. Candidato naturale per la prossima sessione infra: convertirli.

### TD / forward tracciati (oltre ai presidi sopra)

- **🆕 `TD-db-dist-stale-runtime` (tier MEDIO, da Sub-B).** Ogni protezione runtime in `packages/db` (a partire dal guard anti-prod-da-host) è reale sull'host **solo se il `dist` è fresco**: l'host esegue il compilato, non il src. **Correzione a verbale:** Sub-A è stato **inerte a runtime sull'host** dal merge di #168 (15/07) fino al rebuild di Sub-B — nel sorgente/test era attivo, nel `dist` (2026-07-14, pre-Sub-A) no. L'ha rivelato la verifica runtime abilitata da Sub-B. **Dati tier:** `verify:guard-runtime` è **on-demand** (non CI/pre-commit); root `pnpm dev` ricostruisce (`turbo ^build`) ma `pnpm --filter <api> dev` diretto no; `ci.yml` (~riga 253) documenta già lo stesso gap e lo tampona con un build esplicito. **Mitigato** da Sub-B dev-by-default (target 55432, non prod). **Trigger:** mecanizzare il rebuild — `predev` build di `packages/db`, o risoluzione `@gestionale/db` al sorgente TS per i dev server, o `verify:guard-runtime` in CI/pre-commit. Dettaglio in PROGRESS [2026-07-23] + [ADR-0072 §3](../architecture/ADR-0072-dev-db-isolated-and-init-conventions.md).
- **`app.is_super_admin` (flussi JWT / RLS) — verificato NON-BUG** (STOP 0 read-only, 2026-07-22). Segnalazione chiusa senza fix: (1) non è un claim JWT (payload minimale `sub`/`tenantId`/`sessionId`/`type`); (2) GUC via `SET LOCAL` in tx interattiva, **stesso scope** di `tenant_id`, reset a commit → nessuna persistenza cross-request (nessun `SET` nudo in prod); (3) `isSuperAdmin=false` costante in **tutti e 5** gli entrypoint del request-path, `true` solo server-side (`withSystemContext`/`withSuperAdminContext`), path platform gated a **doppio strato** (`PlatformGuard` + `@RequirePermissions`); (4) policy default **fail-closed** (`current_setting(...,true)`→NULL→nega). **Nessun leak cross-tenant.** Dettaglio in PROGRESS [2026-07-22]. Unico residuo = gap copertura CI → foldato in `TD-ci-e2e-testcontainers-be` (presidio #2).
- ~~**`TD-blob-download-no-refresh`**~~ — **CHIUSO** su branch `fix/blob-download-auth-refresh` (non ancora mergiato). I 5 `fetch` raw accountant (3 download blob + 2 upload multipart, non solo i 3 previsti) ora passano da `apiGetBlob`/`apiPostMultipart` (core `fetchWithAuthRetry`) → coperti dal single-flight #160. `request()` invariato. Runtime verificato via e2e route-mocked Sub-1 (9/9). Vedi PROGRESS [2026-07-22].
- **`TD-blob-retry-duplication`** (nuovo, da questo fix) — logica 401→refresh→retry duplicata tra `request()` (ramo JSON) e `fetchWithAuthRetry` (ramo `Response`). Trigger: prossima modifica sostanziale a retry/refresh → unificare `request()` sopra `fetchWithAuthRetry`, GATE sui test interceptor. Tier riattivazione ALTO (path critico condiviso).
- `TD-articles-flat-endpoint` — picker articoli con fetch O(N); trigger = 2° consumer lista-articoli (KDS/Cassa).
- `TD-rbac-tavolo-write-subset` (ADR-0058) — path RBAC negativo mai esercitato; trigger = 1° ruolo non-admin su tenant restaurant reale.
- **`TD-prisma-studio-prod-unguarded`** (nuovo, da Sub-A; tier BASSO-MEDIO) — `prisma studio` (`prisma:studio`) è Prisma CLI: non attraversa `createPrismaClient()` né il nostro codice → il guard anti-prod-da-host **non lo protegge**. Un editor visuale sul DB prod resta apribile da host senza guard. **Trigger:** prossimo hardening dell'accesso host al DB, o primo near-miss legato a studio → opzioni (non ora): wrapper che rifiuta senza `ALLOW_PROD_DB_ACCESS=1`, oppure rimozione dello script.
- `TD-pricing-multilistino` (ADR-0068), `TD-storage-gc`, `TD-documenti-tipo-codice` / `TD-utente-enum-forward` (ADR-0065, deferred-con-trigger).

---

## PARTE B — Ripartenza prossima sessione

### Base

Main @ `167cb3d` (+1 commit `docs(handoff)` in arrivo via questa PR). Working tree pulito, nessuna PR feature aperta, nessun branch `feat/*` residuo. Deploy verificato empiricamente (§Parte A).

### Due punti di ripartenza, per contesto

**Se si torna sull'accountant:** `TD-blob-download-no-refresh` è **chiuso** su branch `fix/blob-download-auth-refresh` (in attesa di merge) — completamento naturale di #160, i 5 blob/multipart ora sotto single-flight. Alla ripresa: mergiare la PR, poi (se/quando esiste un dev env isolato) chiudere **Sub-2** (verifica full-stack contro BE reale).

**KDS board Fase 1 — ✅ FATTA (2026-07-23, branch `feat/kds-board`, [ADR-0073](../architecture/ADR-0073-kds-board-fase-1.md)).** `kds/page.tsx` non è più placeholder: `comande-api.ts` (wrapper feed, zero fetch raw) + board (colonne per reparto, righe per portata in ordine di servizio, note evidenziate, polling 8s) + avanzamento forward-only (ottimistico + rollback + anti-race polling). `comande.stato.cambia` ora **consumato** (non più orfano lato FE). Verificato runtime su dev env Sub-B (invia→board→avanza). **Fase 2 residua** (ADR-0073, trigger espliciti): kiosk layout route group `(kiosk)/`, segnale storno passivo sulla board, e2e Playwright KDS, SSE (trigger invariato).

### Rotta blocco restaurant (invariata)

**Comande ✅ → KDS board Fase 1 ✅ (Fase 2: kiosk + storno board + e2e) → Cassa pre-fiscale → RT differito.**

- **Cassa pre-fiscale** sbloccata da `vatPercent` (#161): conto/totali/pagamento/chiusura/audit, documento interno, zero omologazione. **RT = blocco separato e DIFFERITO** (solo cliente reale che emette scontrini fiscali).
- **Coperto**: spec non scritta, avvicinata da coperti-warning (#162) + `vatPercent`.
- **AI-pilota food**: blocco dedicato, decision point da sciogliere sull'aggregato comande reale. Prerequisito: estrazione `GroqService` da `accountant-api` a `@gestionale/platform` (tier alto), giustificata dal caso scelto, non speculativa.

### Coda feature sotto la linea (non roadmap attiva)

Note Spese (spec locked STOP 1 rev.2, non implementata), varianti, accorpamento, sconti, allergeni, cassa, kiosk (PR-3b).

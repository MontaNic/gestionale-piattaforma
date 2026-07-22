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

1. **`TD-dev-env-punta-prod` — priorità ALZATA con evidenza odierna.** Non è un TD nuovo: è già tracciato. Oggi ha quasi prodotto un incidente — i **dev server stavano per puntare a produzione** (`.env` dev → DB prod). Non più teorico. Fix = isolamento dev/prod **nel meccanismo** (env separati / DB dev dedicato), non disciplina. **Primo presidio da chiudere.**
   - **Sub-A (guard anti-prod-da-host) — MERGED** (#168, main @ `28d2b81`). Guard meccanizzato `assertSafeDbTarget(url, ctx)` (funzione pura, 9 test) wired in `createPrismaClient()` + `purge-tenant`: un processo Node da host che punta a `127.0.0.1:5432/gestionale` con `NODE_ENV`≠production e senza `ALLOW_PROD_DB_ACCESS=1` **aborta prima di ogni query**. Inerte nei container prod (`NODE_ENV=production`) e sui Testcontainers (`gestionale_test`/porta random). Chiude il **vettore** del near-incident, non l'intero TD. **Resta Sub-B:** un dev env con DB isolato (che sblocca anche Sub-2). Gap noto → `TD-prisma-studio-prod-unguarded` (§TD).
   - **Sub-2 (bloccato da questo TD):** la verifica **full-stack** dei 5 path blob/multipart accountant contro BE reale (`TD-blob-download-no-refresh`, §7) è rinviata proprio perché manca un DB dev isolato e §7 vieta prod. **Trigger:** appena esiste il dev env isolato → login reale + download/upload + assert `/auth/refresh` singola lato BE (pattern test-3 `auth-refresh-single-flight.spec.ts`). Nel frattempo copre il runtime FE l'e2e route-mocked Sub-1.
2. **`TD-ci-e2e-testcontainers-be` (ADR-0071).** La e2e BE di `restaurant-api` non gira in CI → il comportamento comande/conti (pricing/RBAC/state-machine/storno/feed/audit) è validato solo in locale; una regressione non verrebbe colta dalla CI. Fix nel meccanismo = Postgres nel runner (il job Playwright ne ha già uno). **Assorbe (2026-07-22) l'ex-`TD-CB`** come sotto-obiettivo esplicito: in CI la suite e2e api gira da **superuser DB** → l'enforcement **RLS DB-level come `gestionale_app`** non è esercitato (mitigato solo parzialmente da `smoke:rls-core`, core-only). Stesso trigger/fix → chiude entrambi i fronti.
   - **`TD-ci-e2e-accountant-web-fe` (nuovo, analogo FE).** `blob-auth-refresh.spec.ts` è CI-compatibile (webServer `next dev` + route mock, zero rete/DB esterni) ma il job `e2e-playwright` esegue **solo** `apps/restaurant-web` → la spec gira solo on-demand (`pnpm --filter accountant-web test:e2e:blob`): safeguard dipendente dalla memoria dell'operatore. **Trigger:** prossimo intervento sull'infra CI e2e → aggiungere `accountant-web` al job Playwright. **Tier riattivazione:** MEDIO.
3. **Termometro deploy.** Oggi «cosa gira in prod» è stato ricostruito a mano (image ID + marker nel bundle + count migration). Serve un check che dica quale SHA gira **senza affidarsi alle note versioned** (che oggi mentivano). Nel meccanismo, non nella memoria.
4. **Tag-rollback-obbligatorio.** Il pattern «tagga `:rollback-pre-<feature>` PRIMA del build» oggi ha tenuto (10 tag sani), ma dipende dalla disciplina dell'operatore. Renderlo **step dello script di deploy**, non promemoria.

Comun denominatore: ognuno ha una versione «meccanismo» che elimina la dipendenza dalla memoria. Candidato naturale per la prossima sessione infra: convertirli.

### TD / forward tracciati (oltre ai presidi sopra)

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

**Se si prosegue il blocco restaurant → entry-point: PR-3a board KDS.** `kds/page.tsx` è oggi `PlaceholderPage`. È il consumer di `comande.stato.cambia` (già attivato #156) + del payload portata/storno già predisposto nel feed. Primo passo = **STOP 0 read-only** della pagina. CHECK-FE dovuti (dark mode, i18n parity IT↔EN, no hardcoded IT, `next build` isolato, responsive, a11y).

### Rotta blocco restaurant (invariata)

**Comande ✅ → KDS (PR-3a board, PR-3b kiosk) → Cassa pre-fiscale → RT differito.**

- **Cassa pre-fiscale** sbloccata da `vatPercent` (#161): conto/totali/pagamento/chiusura/audit, documento interno, zero omologazione. **RT = blocco separato e DIFFERITO** (solo cliente reale che emette scontrini fiscali).
- **Coperto**: spec non scritta, avvicinata da coperti-warning (#162) + `vatPercent`.
- **AI-pilota food**: blocco dedicato, decision point da sciogliere sull'aggregato comande reale. Prerequisito: estrazione `GroqService` da `accountant-api` a `@gestionale/platform` (tier alto), giustificata dal caso scelto, non speculativa.

### Coda feature sotto la linea (non roadmap attiva)

Note Spese (spec locked STOP 1 rev.2, non implementata), varianti, accorpamento, sconti, allergeni, cassa, kiosk (PR-3b).

# HANDOFF — Gestionale / "One Platform"

> Documento di passaggio sessione. **Parte A** = contesto operativo stabile (onboarding, ambiente, workflow, convenzioni). **Parte B** = snapshot dinamico dello stato. Insieme a `PROGRESS.md` e agli ADR è una **fonte autoritativa**: in caso di divergenza con la memoria, vincono questi documenti.

---

# PARTE A — Contesto operativo (stabile)

## A1. Progetto & ruoli

**Gestionale** (brand in evoluzione → "One Platform"): piattaforma SaaS multi-tenant AI-native, core tecnico condiviso + più applicazioni verticali. Sviluppatore solo: **Nicolò** (comunica in italiano, messaggi molto sintetici).

**Workflow a tre ruoli triangolato:**

- **Claude strategico** (chat): architettura, governance ADR, STOP-gate, spec drop-in, pre-merge review, autore HANDOFF.
- **Claude Code** (VS Code Remote-SSH): tutte le operazioni su file, git, esecuzione test, merge (`gh pr merge --squash --delete-branch`).
- **Nicolò**: orchestratore — fa da ponte tra gli agenti, decide lo scope, esegue sudo e test browser, conferma CI verde prima del merge.

## A2. Repo & ambiente

- Repo: `MontaNic/gestionale-piattaforma` (privato). Server host SSH `gestionale-test`, working dir `/home/deploy/projects/gestionale`, accesso via VS Code Remote-SSH da Mac.
- ⚠️ Host SSH `portal` = StudioDesk PHP **produzione** (`/var/www/portal`) — **mai scrivere lì**.
- Docker Compose non-standard: `docker-compose.dev.yml` (richiede flag `-f`).
- `redis-cli` → `sudo apt install -y redis-tools`; Redis su `127.0.0.1:6379`.
- `turbo run dev` sopravvive all'uscita SSH come daemon PPID=1: per fermarlo, kill del parent prima dei child (evita la ricreazione `--respawn`).
- Diagnosi processi: `sudo ss -tlnp | grep -E "3000|3001|3002|3003"` (non `lsof`).
- Web fetch fallisce sui repo privati GitHub → Nicolò incolla il contenuto raw per la review.
- Istruzioni terminale in shortcut Mac (Cmd, non Ctrl).
- `git branch -D` (force) serve dopo squash merge via UI GitHub (SHA diverso); non dopo `gh pr merge --squash`.
- ⚠️ `.claude/scheduled_tasks.lock` può comparire untracked (artefatto harness Code) → **mai committarlo**; usare `git add` selettivo, non `git add -A`.

## A3. Stack

pnpm workspace monorepo + Turborepo (`turbo.json`: il task `test` ha `dependsOn: ["^build"]`). Backend NestJS, frontend Next.js 15, DB condiviso Prisma/PostgreSQL con RLS, Redis, Mailpit, Playwright E2E, Testcontainers.

**Applicazioni:**

- `apps/restaurant-api` (`@gestionale/restaurant-api`, :3000) + `apps/restaurant-web` (`@gestionale/restaurant-web`, :3001) — 1° verticale (ristorazione), con dominio menu.
- `apps/accountant-api` (`@gestionale/accountant-api`, :3002) + `apps/accountant-web` (`@gestionale/accountant-web`, :3003) — 2° verticale (commercialisti / StudioDesk).

**Package core estratti** (`@gestionale/*`): `db`, `auth`, `auth-web`, `platform`, `shared`, `ui`, `i18n`, `api-client`, `eslint-config`.

- `@gestionale/db`: entry `.` agnostico (Prisma client + `id()` UUID v7 + estensioni RLS/soft-delete) + sub-entry **`@gestionale/db/nest`** (`DbService`/`DbModule`, ADR-0028); NestJS è optional peer + devDep (entry `.` resta agnostico).
- `@gestionale/platform`: include `common/` (GlobalHttpExceptionFilter + `prisma-errors` con `catchUniqueViolation`).

## A4. Workflow STOP-gate

1. **STOP 0** — preflight read-only: legge la fonte autoritativa (BRIEF/DDL/pattern esistenti) + verifica path/firma/struttura prima di impegnare lo scope. Empirical-first.
2. **STOP 1** — spec drop-in per Code (un blocco atomico per turno; gli STOP sono confini di turno reali).
3. **STOP 2** — spot-check sul **diff reale** (singolo blocco `git --no-pager`; verifica file-per-file).
4. **STOP 3** — commit + PR + ADR.

**Merge sempre separato:** `gh pr checks <N> --watch` da solo → Nicolò conferma verde → comando separato `gh pr merge <N> --squash --delete-branch`. Mai bundle PR-create + merge. Mai merge via UI GitHub.

commitlint header ≤100 char. Prettier: `PROGRESS.md`/`docs/studiodesk/` esclusi (`.prettierignore`); ADR/seed/eslint **non** esclusi (devono restare clean). CI gira anche sui PR doc-only.

## A5. Convenzioni tecniche ricorrenti

- **Soft-delete** via `update({ deletedAt: new Date() })` esplicito — **mai `.delete()`** (ADR-0021: `.delete()` esce dal context RLS dentro tx atomica).
- **Unicità naturale soft-delete-aware**: partial-unique-index raw `… WHERE deleted_at IS NULL` (Pattern 42 / ADR-0023); **niente `@@unique`** nello schema (Prisma 6 non esprime i partial index). Rimuovere un `@@unique` impatta 3 superfici: `WhereUniqueInput`, upsert seed idempotenti, `ON CONFLICT` raw.
- **Conflict P2002**: pre-check `findFirst` (soft-delete-aware) + `catchUniqueViolation(fn, errorCode)` da `@gestionale/platform` come backstop (ADR-0024).
- **RLS**: policy `<table>_tenant_isolation` USING-only (`is_super_admin OR tenant_id = current_setting('app.tenant_id', true)`) + `ENABLE`/`FORCE ROW LEVEL SECURITY`. GRANT DML su `gestionale_app` ereditato da `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` (no GRANT esplicito).
- **DI in harness e2e**: `@Inject(Token)` esplicito ovunque (SWC non emette `design:paramtypes`; Discovery #29).
- **E2E api**: Testcontainers Postgres/Redis, full `AppModule` bootstrap, `supertest`. La `ValidationPipe` **non** si attiva in e2e (SWC) → i constraint DTO si testano via **unit test** class-validator (TD-BS Sub-2). E2E api **solo locale**, non in CI (TD-CB). Suite gira come superuser → isolamento testato **applicativo** (TD-BV).
- Bug scope-adjacent trovati durante una feature PR: fix nella stessa PR con razionale documentato (Pattern 41). Artefatti visivi (screenshot) non giustificano un fix senza prima verifica empirica del codice (Pattern 24 / Errore #18).

## A6. Comunicazione & deleghe

- Messaggi terse ("a", "p", "procedi", "vai", "si", "confermo") = approvazione/delega. Eco della domanda = delega a procedere con la raccomandazione _starred_.
- Delega esplicita ("ok tua raccomandazione" / "decidi tu"): Claude dà **un solo** push-back rispettoso su decisioni sostanziali, poi se Nicolò reitera → procede. Mai più di un push-back sulla stessa decisione.
- Artifact = drop-in markdown via `create_file` + `present_files`, senza meta-commento. Spiegazioni/raccomandazioni in chat solo quando ci sono decisioni (Sub-DP, scelte architetturali).
- **PII**: se Nicolò incolla dati sensibili (IP, host, MAC, secret, token, password nuove, path con username di sistema) → segnalare subito + oscurare negli output successivi + suggerire di oscurare i paste futuri. Mai dati sensibili nei backup memoria di fine sessione.

## A7. Riferimenti

- `docs/handoff/HANDOFF.md` (questo) + `PROGRESS.md` + ADR (`docs/architecture/ADR-*.md`) = stato autoritativo (vincono sulla memoria).
- StudioDesk reference: `docs/studiodesk/` (67 file DDL + guida, ~150 tabelle, database-per-tenant, PII-free) — modello dominio del verticale commercialisti.

---

# PARTE B — Snapshot stato

**Main @ `79182e2`** (+1 commit `docs(handoff)` in arrivo via PR).

## B1. Sessione corrente — avvio 2° verticale (commercialisti) fino alla prima slice dominio

Quattro PR mergiate in sequenza:

| PR  | ADR      | Contenuto                                                                                                                                                                                                        |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #71 | ADR-0028 | `DbService`/`DbModule` estratti in sub-entry `@gestionale/db/nest` (self-reference import + `@gestionale/db` in `external` tsup → pool unico; NestJS optional peer + devDep; `typesVersions` bridge per node10). |
| #72 | ADR-0029 | Walking skeleton `apps/accountant-api` (core-only replica di restaurant-api, :3002, tenant `studio-demo` seedato, zero dominio).                                                                                 |
| #73 | ADR-0030 | Walking skeleton `apps/accountant-web` (Next.js 15, replica shell/auth, :3003 → :3002, Sidebar 3 voci dashboard/clienti/fatture, i18n riscritto, `@gestionale/db` escluso come dead-dep FE).                     |
| #74 | ADR-0031 | **Prima slice dominio `aziende`** (anagrafica clienti): schema `Azienda` + migration RLS/partial-unique + modulo CRUD in accountant-api + **prima suite e2e Testcontainers** del verticale.                      |

**Dettaglio slice `aziende` (#74):** modello MVP 15 campi (no RFM, no arricchimento — deferiti), `id` UUID v7 + `tenantId` FK Cascade + `deletedAt` (collassa `eliminato`+`eliminata_il`) + `attivo` distinto; enum `TipoCliente{azienda,persona_fisica}`; unicità `codice` per-tenant via partial-unique `aziende_tenant_codice_active_uq … WHERE deleted_at IS NULL`; RLS `aziende_tenant_isolation`; soft-delete via update esplicito; conflict pre-check + `catchUniqueViolation`; rotte `/api/v1/aziende` con `anagrafica.cliente.{visualizza,crea,modifica,elimina}`; DELETE → `200 {id,deleted:true}`. Aggiunto permesso `anagrafica.cliente.elimina` al catalogo (32→33). Suite e2e `aziende-crud` 11/11.

## B2. Stato foundation

- **1° verticale** (ristorazione): operativo, con dominio menu.
- **2° verticale** (commercialisti): skeleton BE+FE completo (ADR-0029/0030) + **prima slice dominio `aziende`** su main (ADR-0031). Credenziali demo (dal seed): tenant `studio-demo`, `admin@studio.local` / `Studio123!`.

## B3. Next step immediato

**STOP-c2 — UI `aziende` in `accountant-web`**: pagina lista (tabella, stato attivo/soft-delete) + form create/edit (15 campi MVP, select `tipoCliente`, gestione errori `E_AZIENDA_*` via `messageForErrorCode` già nel FE), consumando il CRUD `/api/v1/aziende` su :3002, + seed demo aziende per `studio-demo` (lista non vuota). **Decisione aperta**: come riempire lo slot nav (rinominare `clienti`→`aziende`, o etichetta `clienti` con route `aziende`). Parte da **STOP 0** sull'anatomia FE reale (come restaurant-web struttura una pagina dominio con data-fetching + form).

## B4. Sull'orizzonte

- STOP-c3 (eventuale): entità satellite di `aziende` (referenti, log modifiche, reparti) o riaggancio RFM (`operatore_riferimento_id`→users, circolare) / blocco arricchimento `32_*`.
- Brand decision deferita: tre livelli di costo crescente — rename display, rename repo, rename scope `@gestionale/*` ("One Platform").
- `health`/`me`: mantenuti come duplicati app-level (estrarre `health` accoppierebbe `@gestionale/auth` nello shared — indesiderato).
- TD-BY: backend pricing resolution (multi-match canale/priorità) — deferito fino al primo consumer (Cassa).

## B5. Tech debt aperti

| ID                 | Descrizione                                                                                                                                                                                                                                   | Stato       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **TD-RLS-aziende** | RLS DB-level di `aziende` non esercitata da e2e (suite superuser, TD-BV) né da `smoke:rls-core` (solo core tables); isolamento verificato applicativamente + policy presente in DB. Valutare estensione `smoke:rls-core` o e2e non-superuser. | Nuovo (#74) |
| TD-CB              | E2E api Testcontainers solo locale, non in CI.                                                                                                                                                                                                | Aperto      |
| TD-BS Sub-2        | `ValidationPipe` inattiva in e2e (SWC) → validazione coperta da unit DTO.                                                                                                                                                                     | Aperto      |
| TD-BV              | Suite e2e gira superuser → isolamento applicativo, non RLS DB-level.                                                                                                                                                                          | Aperto      |
| TD-BY              | Backend pricing resolution multi-match — deferito al primo consumer.                                                                                                                                                                          | Aperto      |

## B6. Note

- `PROGRESS.md`: la sezione "🚧 In corso" potrebbe essere stale (riallineamento pregresso differito, fuori scope). Le entry storiche per sessione sono autoritative; heading non rinominati se hanno cross-link (anchor stability — espandere il body).
- Nessuna nuova Discovery formalizzata questa sessione (riusati pattern esistenti: #29 `@Inject`, #36 guard order byte-identico, #51 cache slug tenant). Counter Discovery: verificare in `PROGRESS.md`.

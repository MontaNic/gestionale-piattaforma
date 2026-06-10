# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ e5ea9df (UI categorie scadenze custom, PR #92 squash-merged).
> **Data:** 2026-06-11.

---

## PARTE A — Stato del progetto

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali sulla base condivisa `packages/` (`@gestionale/db`, `db/nest`, `auth`, `auth-web`, `platform`, `shared`, `ui`, `api-client`, `i18n`):

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): completo (F1 Menu CRUD + UI).
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): in costruzione attiva. Stato end-to-end:
  - **skeleton** (ADR-0029/0030)
  - **`aziende`** anagrafica clienti — backend (ADR-0031) + UI (ADR-0032)
  - **`referenti`** satellite 1:N — backend (ADR-0033) + UI (ADR-0034)
  - **RLS isolation anagrafica testata DB-level** (ADR-0035)
  - **`preventivi`** — backend (ADR-0036): testata + voci, business logic (ricalcolo totali server-side) + tx atomica + pattern replace-collezione-in-tx
  - **`preventivi` UI** (ADR-0037): lista in sezione `clienti/[id]` + editor voci con totali live mirror della formula server. Primo editor multi-riga del verticale.
  - **RLS isolation preventivi testata DB-level** (LEAN, segue ADR-0035): `preventivi_tenant_isolation` + `preventivi_voci_tenant_isolation` esercitate come `gestionale_app`
  - **dashboard operatore-studio** (ADR-0038): endpoint `/dashboard/stats` (prime query aggregate del progetto) + card-grid (KPI clienti+preventivi + ultimi 5 preventivi)
  - **`scadenze`** calendario fiscale — backend (ADR-0039): primo modulo con **pattern nuovo** (categorie con seed di piattaforma `tenant_id NULL` + custom per tenant). `Scadenza` tenant-level (RLS+FORCE) + `ScadenzaCategoria` (NO RLS, scoping applicativo nel service). Validazioni business nel service (`visibilita='azienda' ⇒ aziendaId`, FK accessibili al tenant).
  - **`scadenze` UI** (ADR-0040): route top-level `/t/[slug]/scadenze` (tenant-level, NON nested) + voce di sidebar dedicata. Lista raggruppata per mese + barra filtri (categoria/stato/visibilità/da-a, partizione backend vs client) + form CRUD inline (RHF+zod, regola visibilità=azienda mirror service) + ConfirmDialog soft-delete. Normalizzazione `dataScadenza` `@db.Date`→YYYY-MM-DD nel layer api. Lista senza relazioni embedded → lookup categoria/azienda client-side.
  - **`scadenze` categorie custom UI** (LEAN, segue ADR-0040, PR #92): sezione "Categorie personalizzate" in fondo a `/scadenze` — lista categorie piattaforma (`tenant_id NULL`, badge "Predefinita") + custom del tenant + form inline `nome`+`colore` (`CategoriaForm`/`CategorieSection`, pattern `ReferentiSection`). Solo create (backend non espone update/delete categorie). `onCreated` refetcha la page → la nuova categoria appare anche nel picker del `ScadenzaForm`. Nessun ADR dedicato.

Catalogo permessi: **37** (`scadenze.{visualizza,gestisci}` da STOP-scad1; `preventivi.{visualizza,gestisci}` da STOP-e1; dashboard riusa `anagrafica.cliente.visualizza`, nessun permesso nuovo).

### Visione del verticale — tre livelli StudioDesk (roadmap, NON scope immediato)

Emersa dal confronto con StudioDesk PHP (host SSH `portal`, produzione legacy, mai scritto). Il verticale punta a replicare l'impianto a tre livelli di portale — **base, non copia al millimetro**:

1. **Operatore-studio** — lo staff dello studio che gestisce i propri clienti. È il livello su cui si è costruito finora (aziende, referenti, preventivi, dashboard). Frontend = `accountant-web`.
2. **Cliente-dello-studio** — l'azienda-cliente che entra a vedere le sue comunicazioni/documenti/scadenze/preventivi. Menu tradizionale a sidebar. **Secondo frontend, non esiste ancora.**
3. **Super-admin-piattaforma** — amministrazione studi (tenant) + server + fatturazione verso gli studi (FIC era questo: la fatturazione di Nicolò _verso_ gli studi, non degli studi verso i loro clienti). Parzialmente coperto dal modulo `tenants`/bootstrap core; sarebbe app/area a sé.

Moduli di dominio StudioDesk ancora mancanti nel TS: Comunicazioni, Documenti & Circolari, Knowledge Base, Questionari, Agevolazioni, Team. **Scadenze** ha ora backend (ADR-0039) + UI (ADR-0040), primo modulo operatore-studio completo end-to-end oltre ad anagrafica/preventivi. La card-grid della dashboard (ADR-0038) è predisposta ad accoglierli come card man mano che nascono. **Nessuna card-placeholder per moduli non costruiti** (YAGNI/Pattern 43).

### Prossimo task — da concordare a STOP 0

Candidate (priorità da validare con Nicolò):

- **Catalogo servizi / fatture FIC** — decisione di prodotto grossa, multi-STOP, FULL. Nota: `fatture` non esiste come tabella StudioDesk diretta (c'è `preventivi` dominio + `fic_billing` integrazione 4 tabelle). FIC = livello 3 (super-admin), decisione di prodotto separata.
- **Altri moduli operatore-studio** (Documenti/Comunicazioni) — verso il completamento del livello 1.
- **Portale cliente-dello-studio** (livello 2) — nuovo frontend, slice grossa.
- **Seed utente non-superuser studio-demo** — LEAN (~20min), sblocca test gating runtime.

### Tech debt aperti

- **TD-BV** — l'intera suite e2e gira come `postgres` superuser (bypassa RLS). Mitigato per anagrafica (ADR-0035) e preventivi (TD-RLS-preventivi) da spec dedicati `gestionale_app`. La **conversione dell'intera suite** a non-superuser resta deferita (Sub-2), da valutare dopo fatture.
- **TD-RLS-dashboard candidate** (ADR-0038) — endpoint `/dashboard/stats` non esercitato da `rls-isolation` e2e; isolamento verificato applicativamente (scenario A/B di `dashboard-stats`) + a runtime non-superuser. Bassa priorità: gli aggregati riusano le stesse policy delle CRUD già esercitate.
- **TD-RLS-scadenze candidate** (nuovo, ADR-0039) — tabella `scadenze` non esercitata da `rls-isolation` e2e (suite superuser TD-BV); isolamento verificato applicativamente (scenario #11 di `scadenze-crud`). La policy è la stessa forma già esercitata da aziende/preventivi. Bassa priorità, coerente con TD-BV.
- **`scadenze_categorie` senza RLS** (per design, ADR-0039) — le righe piattaforma sono `tenant_id NULL` → una policy per-tenant le filtrerebbe via. Protezione **interamente applicativa**: ogni accesso alle categorie DEVE passare dallo scoping del service (read `OR[null,tenant]`, write `tenant`, `categoriaId` validato accessibile). Mai query dirette non scopate.
- **TD-PATCH-null-FK** (nuovo, ADR-0040) — `UpdateScadenzaDto` espone `categoriaId`/`aziendaId` come `@IsUUID` opzionali senza supporto `null` → via PATCH non si può **azzerare** una FK già impostata. In edit, cambiando visibilità da `azienda` ad altro, l'`aziendaId` resta in DB (semanticamente ignorato quando `visibilita≠azienda`, e la UI lista mostra il nome azienda solo se `aziendaId` valorizzato). Fix: accettare `null` esplicito nel DTO+service. Bassa priorità.
- **TD candidate — seed utente non-superuser studio-demo** (da ADR-0037) — **risolto in #87**: seedato `collaboratore@studio.local` (ruolo Collaboratore, non-superuser, ora con `scadenze.*` da STOP-scad1). Sblocca il test di gating runtime di `preventivi.*`/`anagrafica.cliente.*`/`scadenze.*` con un utente reale a permessi limitati (`admin@studio.local` resta Super Admin a 37 permessi).
- **TD-BS Sub-2** — copertura e2e `ValidationPipe→400` bloccata dal harness (vitest 3.x non eredita i plugin SWC nei `test.projects`). Validation 400 coperta da unit DTO; integrazione garantita in prod da `tsc`. Valore incrementale basso.
- **TD-CB** — la suite e2e backend (accountant + restaurant) è **solo-locale**, non gira in CI. Su CI: unit + Playwright FE. Le garanzie "N/N e2e" sono locali.
- **TD-BY** — pricing resolution, defer S23 (verticale ristorazione).

### Convenzioni di processo (in vigore)

- **Gate a due corsie** (PROGRESS): STOP-gate calibrato al rischio. **FULL** se la slice tocca schema/migration/RLS/tx/business-logic/auth-permessi/pattern-nuovo (→ ADR dedicato). **LEAN** se CRUD puro che replica un pattern già in ADR, zero DP nuove (→ 1 spot-check, entry PROGRESS che linka l'ADR-pattern, niente ADR dedicato). Routing a STOP 0.
- **Routing modello per corsia** (nuovo, 2026-06-10): FULL → modello frontier (Fable 5); LEAN → Opus 4.8 o Sonnet; docs-only/HANDOFF/cleanup → Sonnet. Eccezioni che alzano a frontier anche su slice LEAN-apparenti: diagnosi bug/regressione, shared-config/interop CJS-ESM, sessione lunga oltre metà contesto. Lo switch modello si fa **tra sessioni**, non mid-conversation (costo coerenza > risparmio). Il modello dentro Claude Code è impostazione separata, stessa logica.
- **Self-check report a STOP 2**: Claude Code esegue le verifiche meccaniche (status/header/RLS/file-staged/typecheck/lint/e2e/divergenze) e consegna il report PASS/FAIL **prima** del diff. Claude strategico reviewa il giudizio + legge il diff.
- **Principio guida**: test-bed ora, opzione prodotto in futuro. Si investe in **fondamenta ready/scalabili di default**, NON in profondità di dominio o feature premature finché uno studio reale non le richiede. Barra di scope: "lo costruirei comunque per il test-bed?".
- STOP-gate: STOP 0 (preflight empirico read-only) → 1 (spec + DP) → 2 (spot-check/self-check) → 3 (commit/PR/ADR). Merge SEMPRE separato da `gh pr checks --watch`, solo dopo via esplicito di Nicolò.
- `git add` selettivo (mai `-A`); commitlint header ≤ 100; path con `[slug]`/`[id]` quotati; `docs/studiodesk/` READ-ONLY; host SSH `portal` = produzione, mai scrivere.

### Note operative

- **Dev server zombie + `.next` di produzione (ricorrente, Discovery #46):** un `pnpm build` nel gate lascia `.next` di prod che sporca il `next dev` (500/ENOENT vendor-chunk); inoltre i child `next-server` di sessioni precedenti restano orfani su :3003 dopo il kill del parent. È riemerso **due volte** durante STOP-dash1. Mitigazione: prima del dev server `rm -rf apps/*/.next` + `kill` dei `next-server` zombie (per PID o `lsof -ti:3002,3003`). Non è mai un bug del codice di feature.
- Dev server (web:3003 / API:3002): **fermarli** a fine sessione (porte libere). Riavvio in `pnpm dev`; al disconnect SSH i figli Turbo si orfanizzano → kill per PGID o per PID diretto.
- e2e accountant: `pnpm --filter @gestionale/accountant-api test:e2e` (Testcontainers, locale). Suite attuale: aziende-crud 11 + referenti-crud 11 + rls-isolation 10 + preventivi-crud 12 + dashboard-stats 4 + scadenze-crud 13 = **61**.
- Migration: flow `add_<entity>` (`prisma migrate dev --create-only` → appendi blocco RLS/partial-unique a mano → applica). RLS policy `<table>_tenant_isolation` USING-only + FORCE.
- **Gotcha Prisma Decimal (ADR-0037):** Prisma serializza i `Decimal` come **stringa JSON** e i campi `@db.Date` come ISO datetime completo. Normalizzare wire→domain nel layer api-client (Decimal→Number, date→`slice(0,10)`), oppure `toNumber()` nel service backend (scelta dashboard ADR-0038). I domain types restano onesti, i componenti non fanno conversioni difensive.
- **Aggregate sotto RLS (ADR-0038):** `count`/`groupBy`/`aggregate` sono model-op → passano per `$allOperations` in `rls.ts` → RLS-filtered automaticamente sotto il tenant context (nessun wrap esplicito). La `softDeleteExtension` inietta `deletedAt=null` anche su count/aggregate/groupBy (`withSoftDeleteFilter`) → i conteggi non includono i soft-deleted. Verificato a runtime non-superuser.

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ e5ea9df** — `feat(accountant): UI gestione categorie scadenze custom (segue ADR-0040) (#92)`
- Working tree pulito, branch unico `main` allineato a `origin/main`. Nessun branch feature pendente (feat/scadenze-categorie-ui eliminata post-merge).
- PR mergiate nella sessione 2026-06-10/11: #83 (preventivi UI, ADR-0037), #84 (RLS isolation e2e preventivi, LEAN), #85 (dashboard, ADR-0038), #86/#87 (docs/seed), #88 (backend scadenze, ADR-0039), #89 (docs/handoff), #90 (UI scadenze, ADR-0040), #91 (docs/handoff), **#92 (UI categorie scadenze custom, LEAN segue ADR-0040)** — CI verde (Lint·Typecheck·Format·Test + Playwright).

### ADR

Fino a **ADR-0040**. Ultimi del 2° verticale: 0029/0030 (skeleton), 0031/0032 (aziende BE/UI), 0033/0034 (referenti BE/UI), 0035 (RLS isolation anagrafica), 0036 (preventivi backend), 0037 (preventivi UI), 0038 (dashboard operatore-studio), 0039 (scadenze backend — pattern categorie piattaforma/custom), 0040 (scadenze UI — lista/filtri/form CRUD).

### Schema dominio accountant (su `aziende`)

- `Azienda` (anagrafica clienti, 15 campi, campo nome = `nome`, `tipoCliente` enum `azienda|persona_fisica`, `attivo` Boolean, partial-unique `codice`, soft-delete, RLS)
- `Referente` (satellite 1:N, FK azienda+tenant Cascade, enum `RuoloReferente`, soft-delete, RLS)
- `Preventivo` (testata: codice partial-unique, enum `StatoPreventivo` = `bozza|inviato|accettato|rifiutato`, 3 totali Decimal(12,2), `validoFino @db.Date`, soft-delete, RLS) + `PreventivoVoce` (righe: snapshot custom, enum `UnitaMisura`, `tenantId` proprio + RLS dedicata, no soft-delete, `totaleRiga` server-calc)
- `Scadenza` (calendario fiscale, tenant-level: enum `VisibilitaScadenza` = `tutti|azienda|utente`, `dataScadenza @db.Date`, FK opzionali `categoriaId` SetNull / `aziendaId` SetNull, soft-delete, RLS+FORCE, partial-unique `codice_import` predisposto WHERE `deleted_at IS NULL`) + `ScadenzaCategoria` (`tenantId` **nullable** = piattaforma NULL / custom tenant, **NO RLS** → scoping applicativo, **NO soft-delete**, partial-unique `(tenant_id, nome)` WHERE `tenant_id IS NOT NULL`). `visibilita='utente'` + `codice_import` predisposti ma inerti (YAGNI).

### Stack & ambiente

- NestJS 11, Next.js 15, Prisma 6.19.3, PostgreSQL 16 (RLS), Redis 7, Vitest 3.2.4, Testcontainers, Playwright, Tailwind 3.4, shadcn/ui, tsup/esbuild.
- `accountant-web` ha vitest (project registrato in root `vitest.config.mts`, aggiunto in STOP-e2 per il test mirror totali).
- Server Hetzner `gestionale-test` (Ubuntu 22.04), Docker Compose `docker-compose.dev.yml`. Ruolo runtime DB `gestionale_app` (NOSUPERUSER NOBYPASSRLS), migration via `postgres` superuser (DIRECT_URL).
- Tenant demo: `studio-demo` (`admin@studio.local` / `Studio123!`, Super Admin 37 permessi; + `collaboratore@studio.local` / `Collaboratore123!`, ruolo Collaboratore con `scadenze.*`), + `studio-acme` per test isolamento. Seed demo accountant: 5 aziende (AZ001-005, AZ003 attivo=false), 3 referenti, 2 preventivi (PREV-2025-001/002 su AZ001, aliquote miste 22%/10%). Reference data globale: **7 categorie scadenze piattaforma** (`tenant_id NULL`, seedate incondizionatamente).
- Primitive UI nel barrel `@gestionale/ui`: alert, avatar, button, card, dialog, dropdown-menu, form, input, label, sheet, textarea, utils. **Nessuna** primitiva table/select/badge/skeleton/stat → `<table>` HTML grezzo, `<select>` nativo con `SELECT_CLASS` locale, KPI con `Card` + markup.

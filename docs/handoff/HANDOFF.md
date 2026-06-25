# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ `21081e2` (+1 commit docs(handoff) in arrivo via PR).
> **Data:** 2026-06-25.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione densa: **Onda 2 completa** (identità visiva + homepage portale cliente + dashboard differenziata per permesso) + **Task 9 Onda 3 anticipato** (landing pubblica per-tenant stile Apple, ADR-0049) + **Onda 3 Task 1 — Catalogo servizi** (ADR-0050, slice FULL su 6 superfici).

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali-core su base condivisa `packages/`:

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): scaffold congelato. Invariato.
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): **livello 1 + livello 2 COMPLETI** + **Onda 1 COMPLETA** + **Onda 2 COMPLETA** + **Onda 3 Task 1 (catalogo) + Task 9 (landing)**. Catalogo permessi: **52**.

### NOVITÀ sessione 2026-06-25

**1. Identità visiva — due iterazioni (PR #114, #115)**

Prima iterazione: sidebar scura blu navy + accento ambra (PR #114, `b802754`). Dopo review visiva trovata "troppo classica". Seconda iterazione: sidebar chiara bianca, voce attiva `bg-blue-100 text-blue-900` ispirata a Brevo (PR #115, `e6f11ca`). Approvata come base solida.

Modifiche: `globals.css` (CSS variables + Inter font via `next/font/google`), `layout.tsx` (font variable), `Sidebar.tsx` (classi Tailwind dirette: `bg-blue-100 text-blue-900 font-semibold` su voce attiva, `text-gray-700 hover:bg-gray-100` su voci inattive, `bg-white border-r border-gray-200` su container nav).

**2. Homepage portale cliente — Task 5 Onda 2 (PR #116, `a4e7869`)**

Sostituisce il placeholder `portale/page.tsx` con homepage aggregata: comunicazioni non lette, circolari non lette, documenti recenti. Fetch parallelo via `Promise.allSettled` — errore su una sezione non blocca le altre. Pattern identico alle pagine portale esistenti (`useCallback` + `useEffect` + loading/error state).

**3. Dashboard operatore differenziata — Task 6 Onda 2 (PR #117, `bae6c4e`)**

Aggiunta sezione "Scadenze imminenti (prossimi 7 giorni)" in `dashboard/page.tsx`, condizionata a `permissions.includes('scadenze.visualizza')`. Fetch parallelo con fetch stats esistente. Il Collaboratore ha `scadenze.visualizza` → vede la sezione. Sezione fuori dal fragment gated da `canView`. Guard `!isLoading` per evitare flash empty state.

**4. Landing pubblica per-tenant — Task 9 Onda 3 anticipato (PR #118, `de19e3b`)**

Slice FULL — ADR-0049. 6 superfici:

- **Schema**: 6 campi nullable aggiunti a `Tenant` (`descrizione`, `indirizzo`, `telefono`, `emailContatto @map("email_contatto")`, `sitoWeb @map("sito_web")`, `logoUrl @map("logo_url")`). Migration `20260625124846_add_tenant_identity` applicata.
- **`@gestionale/auth`**: `CreateTenantDto` (+6 opzionali, `@IsUrl` su sito/logo) + `TenantsService.createTenant` (persiste i 6, `undefined→null`).
- **Endpoint pubblico**: nuovo `PublicModule/Controller/Service` in `accountant-api`. `GET /api/v1/public/tenants/:slug` (`@Public()`, no JWT). Sicurezza: `withSystemContext` per bypass RLS, select-allowlist 8 campi safe (mai `id/isActive/deletedAt`), filtro `isActive+deletedAt→null` → 404 su tenant sospesi/cancellati.
- **Seed**: `studio-demo` = "Studio Ferretti & Lombardi — Commercialisti Associati", Milano, Via Montenapoleone 8, dati demo con dominio `.example` (RFC 2606, sicuro).
- **FE**: `t/[slug]/page.tsx` nuova (landing pubblica), `public-tenant-api.ts`. Single-page stile Apple: hero centrato, whitespace generoso, sezioni servizi + contatti, CTA "Accedi" → `/t/[slug]/login`. Nessuna shell autenticata, fuori dal gruppo `(authenticated)`.
- **ADR-0049**: decisioni di sicurezza endpoint pubblico documentate.

**5. Questionario portale (30 domande)**

Product discovery completato in sessione. Priorità emerse:

- Upload documenti dal cliente (chiude il loop con download già esistente)
- Notifiche email automatiche (MailService esiste, manca framework trigger)
- Accettazione preventivi online con timestamp
- 2FA obbligatorio clienti (documenti fiscali sensibili)
- Più ruoli per cliente (titolare vs. contabile)

Feature deferrate (dipendenze esterne o tenant pilota reale): firma digitale, pagamento parcelle online, password per documento.

**6. Catalogo servizi — Onda 3 Task 1 (PR #120, `21081e2`)**

Slice FULL — ADR-0050. Listino servizi dello studio riusabile nei preventivi. Due commit (db fondazione + feature). 6 superfici:

- **Schema**: `ServizioCategoria` + `ServizioCatalogo` (pattern `ScadenzaCategoria`: `tenantId` nullable, null = piattaforma condivisa, valorizzato = custom), enum `TipoRicorrenza`, `PreventivoVoce.servizioId` (FK SetNull, snapshot-safe). Migration `20260625193614_add_servizi_catalogo` + **partial unique index** raw SQL `(tenant_id, nome|codice) WHERE tenant_id IS NOT NULL`.
- **No RLS** sui due modelli (righe platform `tenant_id NULL` incompatibili con policy tenant) → scoping applicativo esplicito `OR: [{tenantId:null},{tenantId}]`. Invariante: platform read-only → `assert*Owned()` lancia 403 `E_SERVIZIO_*_PLATFORM_READONLY`.
- **Seed**: 6 categorie + 20 voci piattaforma (`tenant_id NULL`) + 2 permessi `servizi.{visualizza,gestisci}`.
- **BE**: `CatalogoModule` (`/catalogo/categorie`, `/catalogo/servizi`) CRUD gated RBAC; `servizioId` opzionale in DTO/service preventivi voci.
- **FE**: pagina `/t/[slug]/catalogo` (Servizi + Categorie, platform read-only badge), voce sidebar "Catalogo servizi", UX "Dal catalogo" nell'editor voci preventivi (pre-compila voce, snapshot-safe).
- **e2e**: `catalogo-crud` 10 scenari (platform/custom scoping, 403 read-only, isolamento cross-tenant, RBAC viewer). Suite totale **131** (era 121).

Sub-DP (vedi ADR-0050): permessi reali **50→52** (non 55→57: `grep -c "code:"` sovrastima → memoria aggiornata); route FE senza `studio/`; update DTO manuali (no `@nestjs/mapped-types`); `truncateDatabase` e2e esteso con tabelle catalogo (righe platform `tenant_id NULL` fuori CASCADE); pagina catalogo IT hardcoded (TD i18n, da chiudere col namespace catalogo nei prossimi moduli).

### Visione del verticale — tre livelli StudioDesk

1. **Operatore-studio** ✅ COMPLETO
2. **Cliente-dello-studio** ✅ COMPLETO (portale path-based)
3. **Super-admin** ✅ MINIMALE (lifecycle tenant, `oneplatform`)

### Prossimo task — Onda 3 Task 2: Mandati / Incarichi

**Prossimo**: modulo Mandati/Incarichi (lettere d'incarico studio↔cliente). Da scopare con STOP 0 empirico + sezione BRIEF applicabile prima di proporre lo scope.

**Residuo Onda 3** (dopo Mandati): **Email notifiche** (circolari pubblicate, comunicazioni ricevute — MailService esiste, manca framework trigger evento→template→invio) · **Alert scadenze cron** (T-7 e T-1 via email, configurabile dallo studio).

### Fili aperti

- **`STUDIO_DESK.md` extension**: aggiungere sezione AI, cron inventory, feature map per pannello (admin/superadmin/public → stato in gestionale). Da fare prima dell'Onda 3 completa.
- **Nuova chiave Groq** da inserire in `.env` quando si implementano feature AI.
- **Subdomain routing** (`[slug].studiodesk.cloud` per portale cliente): task infra futuro.
- **UI configurazione identità tenant**: oggi solo seed/superadmin. Quando uno studio pilota chiede di cambiare logo/descrizione, serve form in `/platform/tenants/[id]`.
- **Template landing**: betadesk aveva 6 template con stili diversi. Deferred — costruire quando lo studio pilota lo chiede.
- **Invito operatore** via email (oggi solo seed manuale): Onda 4.

### Tech debt aperti

Invariati: **TD-BV** · **TD-CB** · **TD-PATCH-null-FK** · **TD-blocklist-drift** · **`web` external one-time** · **TD-documenti-tipo-codice** · **TD-utente-enum-forward** · **TD-storage-gc** · **TD-moduleResolution-node10** · **TD-circolari-utente-forward** · **TD-portale-com-allegati** · **TD-portale-com-apertura** · **TD-portale-circolari-html** · **TD-immagine-api**.
Nuovo: **TD-catalogo-i18n** (pagina `/catalogo` in IT hardcoded — chiudere col namespace i18n catalogo nei prossimi moduli Onda 3, ADR-0050 DP-7).

### Roadmap onde (aggiornata)

**Onda 1 — Sblocca l'uso reale** ✅ COMPLETA

1. ✅ Reset password (#110)
2. ✅ Invito cliente (#111)
3. ✅ Superadmin minimale (#112)

**Onda 2 — Identità e percezione** ✅ COMPLETA 4. ✅ Identità visiva (PR #114 + #115) 5. ✅ Homepage portale cliente (PR #116) 6. ✅ Dashboard operatore differenziata (PR #117)

**Onda 3 — Valore operativo** 🔜 (parziale) — T1. ✅ Catalogo servizi (PR #120, ADR-0050) · T2. 🔜 Mandati/Incarichi (prossimo) · Email notifiche (circolari pubblicate, comunicazioni ricevute) · Alert scadenze cron (T-7 e T-1 via email) · ✅ Landing pubblica studio (PR #118, anticipato)

**Onda 4 — Piattaforma** 🔜 10. Superadmin monitoring (stato container, disk, memory) 11. Impersonation studio con banner 12. Invito operatore via email

**Onda 5 — Completamento portale cliente** 🔜 13. Upload documenti dal cliente 14. 2FA TOTP 15. Accettazione preventivi online

**Onda 6 — Futuro** 🔜 16. AI subsystem (assistente cliente KB-aware, `AIPolicy` governance) 17. Billing / FIC 18. Audit log UI 19. API pubbliche per-tenant 20. WhatsApp/Telegram notifiche

### Convenzioni di processo (invariate)

- STOP-gate: 0 → 1 → 2 → 3. Merge SEMPRE separato dopo `gh pr checks --watch` + via esplicito.
- `git add` selettivo (mai `-A`); commitlint header ≤ 100 inglese.
- Split commit per rischio (BE → STOP 2 → FE → STOP 2 → push).
- Verifica runtime manuale (ruolo non-superuser) prima di ogni commit FE — regola permanente.
- Empirical-first: mai asserire scope da deduzione.
- Code non usa mai `ask_user_input` — strumento del chat, non suo.
- `docs/studiodesk/` + `betadesk` READ-ONLY.

### Note operative host (aggiornate)

- Repo: `/home/deploy/projects/gestionale`
- Stack live: `docker-compose.dev.yml` + `docker-compose.prod.yml`
- Comando deploy: `docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d --build accountant-api accountant-web`
- DB name: `gestionale`; seed: `db:seed`; container: `gestionale_postgres` / `gestionale_caddy`
- Caddy routing: `/api/*` → `accountant-api:3002`, resto → `accountant-web:3003`
- ⚠️ `/api/v1/health` (non `/api/health`) è l'endpoint reale — il global prefix è `api/v1`
- `DATABASE_URL_DOCKER` / `DIRECT_URL_DOCKER` nel `.env` gitignored (host=`postgres`)
- `PLATFORM_TENANT_ID=01900000-0000-7000-8000-000000000001` nel `.env`
- Nuova chiave Groq: da inserire in `.env` quando si implementano feature AI
- SSH tunnel: `LocalForward 3003 localhost:3003` + `LocalForward 3002 localhost:3002`
- Dev server porta: `next dev -p 3003` hardcoded in `package.json` accountant-web — per dev parallelo a prod usare porta diversa (es. 3010) modificando temporaneamente il flag
- ⚠️ Conflitto editor/filesystem: se Code modifica un file aperto in VS Code, chiudi/ricarica il buffer prima di salvare

---

## PARTE B — Snapshot tecnico

### Git

- **Main @ `21081e2`** (+1 commit `docs(handoff)` in arrivo via PR). Cronologia recente:
  - `21081e2` feat(catalogo): catalogo servizi — schema, CRUD, collegamento preventivi (ADR-0050) (#120)
  - `e6e4492` docs(handoff): aggiorna snapshot a de19e3b — Onda 2 completa + Task 9 (#114-118) (#119)
  - `de19e3b` feat(tenant): landing pubblica per-tenant — identità studio, endpoint pubblico, homepage FE (#118)
  - `bae6c4e` feat(dashboard): sezione scadenze imminenti — differenziazione per permesso (#117)
  - `a4e7869` feat(portale): homepage cliente — comunicazioni, circolari e documenti recenti (#116)
- **Working tree PULITO**, nessun branch pendente.
- ADR in repo fino a **0050**.
- ⚠️ **Deploy posticipato**: `main` è avanti rispetto ai container in prod (su `de19e3b`). Rebuild rimandato a blocco quando Onda 3 è più avanzata. La migration `20260625193614_add_servizi_catalogo` è già applicata al DB condiviso (dev).

### Schema dominio accountant — aggiornato

`Azienda` · `Referente` · `Preventivo` + `PreventivoVoce` · `Scadenza` + `ScadenzaCategoria` · `Comunicazione` + `ComMessaggio` + `ComAllegato` · `DocumentoTipo` + `Documento` · `Circolare` + `CircolareDestinatario` + `CircolareLettura` · `User` (con `UserTipo`, `ClienteRuolo`, `aziendaId`) · **`PasswordReset`** · **`ClienteInvito`**. CHECK constraint `chk_cliente_azienda_id`.

`Tenant` aggiornato: +`descrizione`, +`indirizzo`, +`telefono`, +`emailContatto`, +`sitoWeb`, +`logoUrl` (tutti nullable, migration `20260625124846_add_tenant_identity`).

**Catalogo servizi (ADR-0050)**: `ServizioCategoria` + `ServizioCatalogo` (`tenantId` nullable platform/custom, no RLS) · enum `TipoRicorrenza` · `PreventivoVoce.servizioId` (FK SetNull) · partial unique index `(tenant_id, nome|codice) WHERE tenant_id IS NOT NULL`. Seed: 6 categorie + 20 voci piattaforma.

### Permessi (52 totali)

> Baseline = **52** (lunghezza array `PERMISSIONS` / log seed `Permissions: N attese` / count DB). NON usare `grep -c "code:"` (sovrastima).

Namespace studio: `aziende.*` · `referenti.*` · `preventivi.*` · `scadenze.*` · **`servizi.{visualizza,gestisci}`** · `comunicazioni.*` · `documenti.*` · `circolari.*` · `sistema.*` · **`clienti.invitare`**.
Namespace portale: `portale.documenti.visualizza` · `portale.comunicazioni.{visualizza,rispondi}` · `portale.circolari.visualizza`.
Template "Cliente" → 4 permessi portale. `servizi.visualizza` anche al Collaboratore.

### Stack & ambiente

- NestJS 11, Next.js 15 (standalone), Prisma 6, PostgreSQL 16 (RLS), Redis, Vitest, Testcontainers, Playwright, Tailwind, shadcn/ui, Inter font.
- Server Hetzner `gestionale-test`. Docker Compose (`dev.yml` + `prod.yml`). Caddy custom (wildcard cert `*.studiodesk.cloud`, DNS-01 Cloudflare).
- **App containerizzate e live**: `gestionale-accountant-api-1` + `gestionale-accountant-web-1`.
- Tenant demo: `studio-demo` (= Studio Ferretti & Lombardi, dati identità popolati) + `studio-acme` + **`oneplatform`** (superadmin piattaforma).
- Utenti demo: `admin@studio.local / Admin123!` · `collaboratore@studio.local / Collaboratore123!` · `cliente@studio-demo.local / Cliente123!` · `superadmin@oneplatform.local / Superadmin123!`.
- Landing pubblica: `https://studiodesk.cloud/t/studio-demo` (no login richiesto).
- Betadesk: `/home/deploy/projects/betadesk` — READ-ONLY, riferimento legacy.

### Verifica finale richiesta a Code (chiusura sessione)

Working tree pulito, main @ `21081e2` allineato origin, nessun branch pendente, PROGRESS.md aggiornato con entry [2026-06-25] per sessione (Onda 2 #114-117 + Task 9 #118 + Onda 3 Task 1 catalogo #120).

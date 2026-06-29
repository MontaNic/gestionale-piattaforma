# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ `75476fc` (+1 commit docs(handoff) in arrivo via PR).
> **Data:** 2026-06-29.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione densa: **Onda 2 completa** (identità visiva + homepage portale cliente + dashboard differenziata per permesso) + **Task 9 Onda 3 anticipato** (landing pubblica per-tenant stile Apple, ADR-0049) + **Onda 3 Task 1 — Catalogo servizi** (ADR-0050, slice FULL su 6 superfici).

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali-core su base condivisa `packages/`:

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): scaffold congelato. Invariato.
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): **livello 1 + livello 2 COMPLETI** + **Onda 1 COMPLETA** + **Onda 2 COMPLETA** + **Onda 3 COMPLETA** + **Onda 4 Task 3b — Tariffario (#127, ADR-0055)** + **i18n superfici operatore (#129)** + **picker voce timesheet (#132)** + **Task 9 (landing, anticipato)**. Catalogo permessi: **58**.

**Onda 3 — pipeline cliente: COMPLETA** (preventivo → mandato → timesheet → margine):

- Task 1: Catalogo servizi (#120, ADR-0050)
- Task 2: Mandati/Incarichi (#122, ADR-0051)
- Task 3: Timesheet/Prestazioni (#124, ADR-0053)
- Task 4: Report margine (#125, ADR-0054)
- (+ Processo: GATE checklist obbligatoria FE/BE/DB, #123, ADR-0052)

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

### NOVITÀ sessione 2026-06-26 — Onda 3 completata (#122–#125)

Continuazione dell'arco Onda 3 (#120 catalogo già sopra). 5 PR mergiate (#122/#123/#124/#125 + questa PR doc), tutte con **GATE ADR-0052** completo dalla #124 in poi.

**7. Mandati / Incarichi — Onda 3 Task 2 (PR #122, `87241b1`, ADR-0051)**

Lettera d'incarico che nasce da un preventivo **accettato**. `Mandato` (RLS FORCE standard) + `RdlCounter` (counter per-tenant per-anno, pattern `ComCounter`) → codice `RDL-<anno>-<NNNN>`. Relazione **1:1** col preventivo: nuovo stato `convertito` su `StatoPreventivo` (alla creazione del mandato il preventivo `accettato → convertito`, guard atomico) + **partial-unique** `(preventivo_id) WHERE deleted_at IS NULL`. `importoConcordato` = snapshot `preventivo.totale`. Creazione come azione: `POST /preventivi/:id/mandato`. FE: pulsante "Crea mandato" sul preventivo accettato + pagine `/mandati` (lista) e `/mandati/:id` (dettaglio/edit). Permessi `mandati.*` → **54**, anche a Collaboratore.
Sub-DP: `Preventivo.mandati` è `Mandato[]` a livello Prisma (il partial-unique soft-delete-aware non è esprimibile come `@@unique`; il service legge l'attivo con `findFirst({ preventivoId, deletedAt: null })`); `convertito` incluso nello schema Zod per type-match ma escluso dal select editing; badge/label `convertito` aggiunti (i18n it/en); `truncateDatabase` esteso con `mandati`/`rdl_counter`.

**8. Dark mode + GATE checklist ADR-0052 (PR #123, `fbf8c83`, ADR-0052)**

Fix dark mode Sidebar (regressione vista in prod): `border-gray-200 bg-white` → `border-border bg-background`, voce inattiva → `text-muted-foreground hover:bg-muted hover:text-foreground`, voce attiva blu Brevo + `dark:bg-blue-900/30 dark:text-blue-100`; badge stato mandati con varianti `dark:`. Parità i18n IT↔EN già allineata. **ADR-0052** introduce la **GATE checklist obbligatoria** (FE: dark mode / i18n parity / hardcoded IT / build / responsive / a11y; BE: RBAC minimo / soft-delete invisibility; DB: migrate deploy su DB pulito) — i check entrano nei prompt STOP 1 da qui in avanti e nel self-check report di ogni PR. Branch rebasato su `origin/main`.

**9. Timesheet / Prestazioni — Onda 3 Task 3 (PR #124, `d71f89e`, ADR-0053)**

Registrazione ore sui mandati (differito da ADR-0051 §8). `Prestazione` (RLS FORCE) nested: `GET/POST/PATCH/DELETE /mandati/:id/prestazioni`. Guard **create**: solo mandato `in_corso` → 400 `E_MANDATO_NOT_IN_CORSO` (update senza guard, correzioni a posteriori). `importo` manuale **nullable** (no tariffario), `ore` obbligatorio. `userId` = autore assegnato **server-side**; `voceId` opzionale validato vs il preventivo del mandato. Permessi **distinti** `prestazioni.*` → **56** (un praticante registra ore senza gestire i mandati): a Collaboratore **e Praticante**. FE: `PrestazioniSection` in `/mandati/:id` (lista + form + totali ore/importo). e2e suite **151**.
Sub-DP: `voceId` omesso dal form FE (BE-supported); `AuthenticatedUser.id` (non `userId` esterno).

**10. Report margine — Onda 3 Task 4 (PR #125, `f21a164`, ADR-0054)**

Prima vista analitica di redditività. **Read-only puro** (nessuno schema/migration/seed). `GET /report/margine` (permesso **riusato** `report.operativo.visualizza`): per ogni mandato → `oreTotali` (Σ ore), `importoPrestazioni` (Σ importo non-null; **null** se nessun importo), `margine` (concordato − importoPrestazioni; **null** se importoPrestazioni null). Lista **flat** ordinata **margine ASC**, null in coda. Decimal→number server-side. FE: pagina `/report/margine` (margine verde/rosso/grigio) + nuovo **gruppo sidebar "Report"**. e2e suite **154**.
Sub-DP: `importoPrestazioni null ≠ 0` (distingue assenza-dato da zero); Groq insights **deferiti** finché manca il tariffario.

### NOVITÀ sessione 2026-06-29 — Onda 4 Task 3b: Tariffario orario (PR #127, `01aaea8`, ADR-0055)

Chiude il **TD-tariffario**. Tariffa = **costo orario interno** per ruolo (default) o utente (override), da cui deriva automaticamente `Prestazione.importo` (`ore × tariffa`) → sblocca `importoPrestazioni`/`margine` del report (ADR-0054) e, a valle, gli insight AI margine.

- **Schema**: `TariffaOraria` (`tariffe_orarie`, RLS FORCE). Scope esclusivo `roleId` XOR `userId` via **CHECK** raw SQL `(role_id IS NOT NULL) <> (user_id IS NOT NULL)`; **2 partial-unique** soft-delete-aware `(tenant_id, role_id|user_id) WHERE ... IS NOT NULL AND deleted_at IS NULL`. Migration `20260629090933_add_tariffe_orarie` (applicata al DB condiviso).
- **Risoluzione** (`TariffeService.resolveTariffaOraria`): override-utente → tariffa-ruolo (la **più alta** se l'utente ha più ruoli con tariffa, tie-break confermato; warning loggato) → `null` (importo resta null, comportamento odierno).
- **Derivazione** in `PrestazioniService` su create + update-quando-`ore`-cambia. Precedenza **manuale > derivato > null**. Nessuna modifica a `Prestazione` né all'endpoint report. `round2` estratto in `common/money.util`.
- **BE**: `TariffeModule` — CRUD `/tariffe` (`tariffario.{visualizza,gestisci}`) + lookup `/tariffe/{roles,users}` (gated `gestisci`, dichiarati prima di `:id`). Error code `E_TARIFFA_SCOPE_INVALID`/`_ROLE_NOT_FOUND`/`_USER_NOT_FOUND`/`_DUPLICATA` (409)/`_NOT_FOUND`.
- **Permessi** `tariffario.{visualizza,gestisci}` → **58** (56→58). Dati di costo sensibili → solo `ALL_PERMISSION_CODES` (Super Admin/Admin sede/Socio); **non** a Collaboratore/Segreteria/Praticante. La derivazione è server-side e non richiede il permesso.
- **FE**: pagina `/tariffario` (CRUD con picker scope ruolo/utente, scope immutabile in modifica), **voce sidebar gated per-permesso** (nuovo `requiredPermission`), hint "calcolato dal tariffario se vuoto" sul campo importo prestazione.
- **e2e suite 175** (+25: CRUD/RBAC/scope-XOR/duplicata/cross-tenant/derivazione/tie-break/lookup). Verifica runtime manuale come non-superuser ✅ (RBAC 403, derivazione live 3×40=120, override manuale, render pagina).

Sub-DP: niente **backfill** storico (manca lo snapshot ruolo-all'epoca → solo prestazioni nuove/update-ore); scope tariffa immutabile in modifica (cambio = soft-delete + ricrea); i lookup roles/users vivono nel TariffeModule (nessuna area RBAC esistente).

### NOVITÀ sessione 2026-06-29 — i18n superfici operatore (PR #129, `4be2a3a`)

Chiude il **TD-i18n-cumulativo**. Esternalizza in **next-intl** le stringhe hardcoded IT delle ultime superfici operatore-studio rimaste in IT. **Solo FE** (nessuno schema/migration/permesso/endpoint).

- **4 nuovi namespace** in parità IT↔EN: `catalogo` (riusa `preventivi.um` per le unità di misura), `mandati` (lista + dettaglio), `report` (margine), `prestazioni` (timesheet embedded in `mandati/[id]`). Totale **577 chiavi** bilanciate.
- **5 superfici** cablate: `catalogo/page.tsx`, `mandati/page.tsx`, `mandati/[id]/page.tsx`, `report/margine/page.tsx`, `components/mandati/PrestazioniSection.tsx`. Le label nav/gruppi erano già i18n. Valori da DB (nomi servizi/categorie/clienti) restano in lingua d'origine.
- **Enum** (`StatoMandato`, `TipoRicorrenza`, unità di misura, Sì/No) tradotti via chiave dinamica (`t(\`stato.${s}\`)`ecc.); rimosse le`Record` di label hardcoded module-level.
- **GATE**: CHECK-FE-2 parità bidirezionale (577), CHECK-FE-3 zero hardcoded residui, risoluzione di tutte le chiavi referenziate (incl. dinamiche), typecheck/eslint/prettier. **Verifica runtime** su dev server come non-superuser (`admin@studio.local` full studio + `collaboratore@studio.local` ristretto) in IT ed EN, **0 errori console**: gating e i18n corretti su tutte le superfici (catalogo lista+form, mandati lista, dettaglio+timesheet, report table, stringa forbidden tradotta). CI #129 verde.

Sub-DP: per la verifica creato mandato di test `RDL-2026-0002` + 2 prestazioni nel DB dev (lasciati, utili per riuso). Resta aperto il **TD-i18n-zod** (messaggi validazione zod fuori dal contesto React).

### NOVITÀ sessione 2026-06-29 — picker voce di preventivo nel timesheet (PR #132, `75476fc`)

Chiude il **TD-voceId-FE** (ADR-0053 sub-DP). `voceId` era già supportato a BE (DTO + validazione `assertVoceDelMandato`) e nei tipi/api-client FE: mancava solo il campo nel form. **Solo FE** (nessuno schema/migration/permesso/endpoint).

- **`mandati/[id]/page.tsx`**: carica le voci del preventivo d'origine via `getPreventivo(aziendaId, preventivoId)` (il `Mandato` espone entrambi) e le passa a `PrestazioniSection`. Fetch in `try/catch` → un ruolo senza `preventivi.visualizza` non blocca la pagina (`voceId` resta opzionale, picker vuoto). Rischio 403 comunque assente: tutti i ruoli con `prestazioni.*` hanno anche `preventivi.visualizza` → niente endpoint dedicato.
- **`PrestazioniSection.tsx`**: select "Voce di preventivo (opzionale)" nel form (default "Nessuna voce") + nuova **colonna "Voce"** in tabella (lookup `voceId→nome`).
- **i18n**: `prestazioni.fields.voce`/`voceNone` + `col.voce` (it/en) → **580 chiavi** in parità.
- **GATE**: parità i18n + risoluzione chiavi, typecheck/eslint/prettier, CI #132 verde. **Verifica runtime** come non-superuser su `RDL-2026-0002` (preventivo con 2 voci), IT+EN, **0 errori**: picker popolato, salvataggio con `voceId`, colonna "Voce" valorizzata.

Sub-DP: lasciata una prestazione di test ("Test voce picker") nel DB dev. Restano deferiti: **TD-i18n-zod**.

### Visione del verticale — tre livelli StudioDesk

1. **Operatore-studio** ✅ COMPLETO
2. **Cliente-dello-studio** ✅ COMPLETO (portale path-based)
3. **Super-admin** ✅ MINIMALE (lifecycle tenant, `oneplatform`)

### Prossimo — Onda 4 (in corso)

**Onda 3 COMPLETA. Onda 4 avviata: Task 3b tariffario ✅ (#127).** All'avvio sessione i container prod sono stati **rebuildati da `main`** (a `b1abe71` = Onda 3) — vedi nota deploy. Candidati Onda 4 restanti: superadmin monitoring (stato container/disk/memory), impersonation studio con banner, invito operatore via email. Sbloccati ora dal tariffario: **insight AI margine** (Groq, ADR-0054 §7). Residui Onda 3 non implementati (email notifiche, alert scadenze cron) da riallocare/confermare.

### Fili aperti

- **`STUDIO_DESK.md` extension**: aggiungere sezione AI, cron inventory, feature map per pannello (admin/superadmin/public → stato in gestionale). Da fare prima dell'Onda 3 completa.
- **Nuova chiave Groq** da inserire in `.env` quando si implementano feature AI.
- **Subdomain routing** (`[slug].studiodesk.cloud` per portale cliente): task infra futuro.
- **UI configurazione identità tenant**: oggi solo seed/superadmin. Quando uno studio pilota chiede di cambiare logo/descrizione, serve form in `/platform/tenants/[id]`.
- **Template landing**: betadesk aveva 6 template con stili diversi. Deferred — costruire quando lo studio pilota lo chiede.
- **Invito operatore** via email (oggi solo seed manuale): Onda 4.

### Tech debt aperti

Invariati: **TD-BV** · **TD-CB** · **TD-PATCH-null-FK** · **TD-blocklist-drift** · **`web` external one-time** · **TD-documenti-tipo-codice** · **TD-utente-enum-forward** · **TD-storage-gc** · **TD-moduleResolution-node10** · **TD-circolari-utente-forward** · **TD-portale-com-allegati** · **TD-portale-com-apertura** · **TD-portale-circolari-html** · **TD-immagine-api**.
Nuovi Onda 3:

- **TD-i18n-zod**: messaggi di validazione **zod** hardcoded IT in tutti i form (definiti fuori dal contesto React → non passano per `t()`). Da chiudere in una slice dedicata su tutti i form insieme (registrato in ADR-0052, nota sotto CHECK-FE-3).
- ~~**TD-i18n-cumulativo**~~ ✅ **RISOLTO** (#129): pagine `/catalogo`, `/mandati`, `/report/margine` + timesheet `PrestazioniSection` ora i18n it/en (namespace `catalogo`/`mandati`/`report`/`prestazioni`, 577 chiavi in parità). Resta solo il TD-i18n-zod.
- ~~**TD-voceId-FE**~~ ✅ **RISOLTO** (#132): select "Voce di preventivo" nel form prestazioni + colonna "Voce" in tabella (ADR-0053 sub-DP). Riusa `getPreventivo` per le opzioni, nessun endpoint nuovo.
- ~~**TD-tariffario**~~ ✅ **RISOLTO** (#127, ADR-0055): tariffario per ruolo/utente → `Prestazione.importo` derivato (`ore × tariffa`). Restano sbloccati gli **insight AI margine** (Groq, deferiti ADR-0054 §7).

### Roadmap onde (aggiornata)

**Onda 1 — Sblocca l'uso reale** ✅ COMPLETA

1. ✅ Reset password (#110)
2. ✅ Invito cliente (#111)
3. ✅ Superadmin minimale (#112)

**Onda 2 — Identità e percezione** ✅ COMPLETA 4. ✅ Identità visiva (PR #114 + #115) 5. ✅ Homepage portale cliente (PR #116) 6. ✅ Dashboard operatore differenziata (PR #117)

**Onda 3 — Pipeline cliente** ✅ COMPLETA — T1. ✅ Catalogo servizi (#120, ADR-0050) · T2. ✅ Mandati/Incarichi (#122, ADR-0051) · T3. ✅ Timesheet/Prestazioni (#124, ADR-0053) · T4. ✅ Report margine (#125, ADR-0054) · (+ GATE checklist ADR-0052, #123) · ✅ Landing pubblica studio (#118, anticipato). Residui riallocati: email notifiche, alert scadenze cron, Task 3b tariffario.

**Onda 4 — Piattaforma** 🔄 IN CORSO — ✅ Task 3b Tariffario orario (#127, ADR-0055) · 🔜 10. Superadmin monitoring (stato container, disk, memory) 11. Impersonation studio con banner 12. Invito operatore via email

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

- **Main @ `75476fc`** (+1 commit `docs(handoff)` in arrivo via PR). Cronologia recente:
  - `75476fc` feat(prestazioni): picker voce di preventivo nel timesheet + colonna Voce (#132)
  - `89c9f5c` docs(readme): refresh framing — StudioDesk verticale attivo (#131)
  - `42f1b13` docs: aggiorna HANDOFF + PROGRESS — i18n superfici operatore (#129) (#130)
  - `4be2a3a` feat(i18n): traduzione IT/EN pagine operatore catalogo/mandati/report + timesheet (#129)
  - `01aaea8` feat(tariffario): listino tariffe orarie + derivazione importo prestazioni (ADR-0055) (#127)
- **Working tree PULITO**, nessun branch pendente (branch `feature/prestazioni-voce-picker` mergiato + eliminato).
- ADR in repo fino a **0055** (0050 catalogo · 0051 mandati · 0052 GATE checklist · 0053 prestazioni · 0054 report margine · **0055 tariffario orario**). i18n #129 e voce-picker #132 sono chiusure TD, senza ADR.
- ✅ **Stato deploy**: i container prod (`accountant-api`/`-web`) sono stati **rebuildati da `main` in chiusura sessione** → allineati a **`75476fc`** (tariffario #127 + i18n #129 + voce-picker #132); health `ok`/`db:connected`. Le migration Onda 3 e **`add_tariffe_orarie`** sono **applicate al DB condiviso** (nessuna nuova migration da #129/#132 — slice FE-only).

### Schema dominio accountant — aggiornato

`Azienda` · `Referente` · `Preventivo` + `PreventivoVoce` · `Scadenza` + `ScadenzaCategoria` · `Comunicazione` + `ComMessaggio` + `ComAllegato` · `DocumentoTipo` + `Documento` · `Circolare` + `CircolareDestinatario` + `CircolareLettura` · `User` (con `UserTipo`, `ClienteRuolo`, `aziendaId`) · **`PasswordReset`** · **`ClienteInvito`**. CHECK constraint `chk_cliente_azienda_id`.

`Tenant` aggiornato: +`descrizione`, +`indirizzo`, +`telefono`, +`emailContatto`, +`sitoWeb`, +`logoUrl` (tutti nullable, migration `20260625124846_add_tenant_identity`).

**Catalogo servizi (ADR-0050)**: `ServizioCategoria` + `ServizioCatalogo` (`tenantId` nullable platform/custom, no RLS) · enum `TipoRicorrenza` · `PreventivoVoce.servizioId` (FK SetNull) · partial unique index `(tenant_id, nome|codice) WHERE tenant_id IS NOT NULL`. Seed: 6 categorie + 20 voci piattaforma.

**Mandati/Prestazioni (ADR-0051/0053)**: `Mandato` (RLS FORCE, `importoConcordato` snapshot, partial-unique `preventivo_id WHERE deleted_at IS NULL`) + `RdlCounter` (counter per-tenant per-anno) + enum `StatoMandato` · `StatoPreventivo` esteso con `convertito` · `Prestazione` (RLS FORCE, `mandatoId` CASCADE, `voceId`/`userId` SetNull, `ore` req / `importo` nullable). Migration `add_mandati`, `add_prestazioni`. Report margine (ADR-0054): nessuno schema (aggregazione read-only).

**Tariffario (ADR-0055)**: `TariffaOraria` (`tariffe_orarie`, RLS FORCE) — `roleId?`/`userId?` (scope XOR via CHECK `tariffe_orarie_scope_xor`), `tariffaOraria Decimal(10,2)`, `attivo`, soft-delete; **2 partial-unique** `(tenant_id, role_id|user_id) WHERE ... IS NOT NULL AND deleted_at IS NULL`; FK tenant/role/user CASCADE. Migration `20260629090933_add_tariffe_orarie`. Deriva `Prestazione.importo` (nessuna colonna nuova su `Prestazione`).

### Permessi (58 totali)

> Baseline = **58** (lunghezza array `PERMISSIONS` / log seed `Permissions: N attese` / count DB). **NON usare `grep -c "code:"`** (sovrastima — conta match non-array). Regola anti-miscount in ADR-0052 / memoria `reference_permission_count_baseline`. Progressione: 50 → 52 (`servizi.*`, #120) → 54 (`mandati.*`, #122) → 56 (`prestazioni.*`, #124) → **58 (`tariffario.*`, #127)**.

Namespace studio: `aziende.*` · `referenti.*` · `preventivi.*` · `scadenze.*` · **`servizi.{visualizza,gestisci}`** · **`mandati.{visualizza,gestisci}`** · **`prestazioni.{visualizza,gestisci}`** · **`tariffario.{visualizza,gestisci}`** · `report.*` · `comunicazioni.*` · `documenti.*` · `circolari.*` · `sistema.*` · **`clienti.invitare`**.
Namespace portale: `portale.documenti.visualizza` · `portale.comunicazioni.{visualizza,rispondi}` · `portale.circolari.visualizza`.
Template "Cliente" → 4 permessi portale. `servizi.visualizza`, `mandati.*` e `prestazioni.*` anche al Collaboratore; `prestazioni.*` anche al Praticante. `tariffario.*` **solo** ai ruoli con `ALL_PERMISSION_CODES` (Super Admin/Admin sede/Socio — dati di costo sensibili). Report margine riusa `report.operativo.visualizza` (nessun permesso nuovo).

### Stack & ambiente

- NestJS 11, Next.js 15 (standalone), Prisma 6, PostgreSQL 16 (RLS), Redis, Vitest, Testcontainers, Playwright, Tailwind, shadcn/ui, Inter font.
- Server Hetzner `gestionale-test`. Docker Compose (`dev.yml` + `prod.yml`). Caddy custom (wildcard cert `*.studiodesk.cloud`, DNS-01 Cloudflare).
- **App containerizzate e live**: `gestionale-accountant-api-1` + `gestionale-accountant-web-1`.
- Tenant demo: `studio-demo` (= Studio Ferretti & Lombardi, dati identità popolati) + `studio-acme` + **`oneplatform`** (superadmin piattaforma).
- Utenti demo: `admin@studio.local / Studio123!` · `collaboratore@studio.local / Collaboratore123!` · `cliente@studio-demo.local / Cliente123!` · `superadmin@oneplatform.local / Superadmin123!`.
- Landing pubblica: `https://studiodesk.cloud/t/studio-demo` (no login richiesto).
- Betadesk: `/home/deploy/projects/betadesk` — READ-ONLY, riferimento legacy.

### Verifica finale richiesta a Code (chiusura sessione)

Working tree pulito, main @ `75476fc` allineato origin, nessun branch pendente, PROGRESS.md aggiornato con entry [2026-06-29] (picker voce timesheet, #132). Container prod rebuildati a `75476fc`.

# HANDOFF — Piattaforma Gestionale (multi-tenant SaaS)

> Documento di passaggio sessione. Sostituisce integralmente il precedente.
> **Snapshot:** Main @ `8a57b2b` (+1 commit docs(handoff) in arrivo via PR).
> **Data:** 2026-06-30.

---

## PARTE A — Stato del progetto

### Natura di questa sessione

Sessione densa: **Onda 2 completa** (identità visiva + homepage portale cliente + dashboard differenziata per permesso) + **Task 9 Onda 3 anticipato** (landing pubblica per-tenant stile Apple, ADR-0049) + **Onda 3 Task 1 — Catalogo servizi** (ADR-0050, slice FULL su 6 superfici).

### Dove siamo

Monorepo pnpm + Turbo, 2 verticali-core su base condivisa `packages/`:

- **1° verticale — ristorazione** (`apps/restaurant-api` / `restaurant-web`): **RIATTIVATO** (ADR-0058, #138). Non più "scaffold congelato": **F1 Menu** (S20/S21) + **F2 Tavoli / Mappa sala** (#138) sono su `main`. La prossima sessione restaurant **riparte da questo stato, non da zero**. +2 permessi `tavoli.*` propri del verticale.
- **2° verticale — commercialisti / StudioDesk** (`apps/accountant-api` :3002 / `accountant-web` :3003): **livello 1 + livello 2 COMPLETI** + **Onda 1 COMPLETA** + **Onda 2 COMPLETA** + **Onda 3 COMPLETA** + **Onda 4 Task 3b — Tariffario (#127, ADR-0055)** + **i18n superfici operatore (#129)** + **picker voce timesheet (#132)** + **i18n messaggi validazione zod (#134)** + **bozza AI risposta comunicazioni (#136, ADR-0056)** + **insight AI margine (#139, ADR-0057)** + **Task 9 (landing, anticipato)**. Catalogo permessi accountant: **58**.

> **Catalogo permessi su `main` = 60** (58 accountant + **2 `tavoli.*`** del verticale restaurant, #138). I permessi tavoli/sala appartengono al verticale ristorazione: non si sommano al perimetro funzionale accountant, che resta 58.

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

Sub-DP: lasciata una prestazione di test ("Test voce picker") nel DB dev.

### NOVITÀ sessione 2026-06-29 — i18n messaggi validazione zod (PR #134, `735743f`)

Chiude il **TD-i18n-zod**. I form FE con schema **zod a module-scope** avevano i messaggi di validazione hardcoded IT (fuori dal contesto React → non passavano per `t()`). **Solo FE** (nessuno schema/migration/permesso/endpoint; il BE emette già `errorCode E_*`).

- **Pattern**: schema spostato dentro il componente in `useMemo(() => z.object({...}), [t])` → `t` in scope, messaggi via `t('validation.*')`, identità resolver stabile per locale, tipo da `z.infer<typeof schema>`.
- **6 superfici**: `AziendaForm`, `ReferenteForm`, `ScadenzaForm` (con `superRefine`), `CategoriaForm`, `PreventivoForm` (testata), `login`. Le altre superfici zod (`InvitiSection`, `forgot/reset-password`, `accept-invite`, `platform/tenants`) usavano già `t()` → non toccate.
- **i18n**: nuovi sotto-namespace `validation` per area con chiavi ICU `{max}` per le lunghezze → **605 chiavi** in parità it/en.
- **GATE**: typecheck/eslint/prettier + parità chiavi, CI #134 verde (Lint·Typecheck·Format·Test + E2E Playwright). **Verifica runtime** con login `admin@studio.local`: messaggi tradotti IT (default+cookie) ed EN su login + form interni (Azienda incl. chiave parametrica `emailInvalid` con `{label}`, Scadenza), **0 errori**.

Nessun TD residuo da questa slice.

### NOVITÀ sessione 2026-06-29 — Bozza AI risposta operatore, Slice A (PR #136, `b18cfae`, ADR-0056)

**Prima integrazione LLM del prodotto.** Nel composer di un thread comunicazioni l'operatore genera una **bozza di risposta** (provider **Groq**, `groq-sdk`); popola la textarea ed è editabile prima dell'invio. Nessuno schema/migration: feature-flag a runtime.

- **Modulo `ai/` trasversale** (`apps/accountant-api/src/ai/`): `GroqService` (prompt sistema+utente, ultimi 5 messaggi `lato≠interno`, `temperature 0.4`, `max_tokens 400`) + `AiController` `GET /ai/status` pubblico → `{ aiEnabled }` (mai la key). Riusabile da future feature AI.
- **Feature-flag su `GROQ_API_KEY`**: assente → `aiEnabled:false`, endpoint **503** (`E_AI_DISABLED`), bottone FE nascosto. Errori upstream/vuoti → 503 con `errorCode` stabile (`E_AI_UPSTREAM`/`E_AI_EMPTY`). Rollout/rollback = presenza della variabile, zero deploy.
- **BE**: `POST /comunicazioni/:id/suggerisci` sotto `comunicazioni.gestisci` (**nessun permesso nuovo** → catalogo resta 58); riusa `getById`, esclude le note interne. Nessuna persistenza.
- **FE**: bottone "Suggerisci risposta" nel `MessaggioComposer` (gated su `aiEnabled`), errore inline; `getAiStatus()` in parallelo al thread (fail-soft). i18n `comunicazioni.ai.*` it/en in parità.
- **GATE**: 10 unit con `groq-sdk` mockato + typecheck/lint/build, **CI #136 verde** (Lint·Typecheck·Format·Test + E2E Playwright 14 passed). **Verifica runtime** con key reale, ruolo non-superuser `collaboratore`: `/ai/status` true, bozza Groq reale (~1.4s), click → textarea popolata, degradazione `aiEnabled:false` → niente bottone. Lasciata `COM-0002` (apertaDa=cliente) nel DB dev.

Nessun TD residuo da questa slice (backlog ADR-0056: audit origine AI, contesto azienda/mandati nel prompt, astrazione provider).

### NOVITÀ sessione 2026-06-29 — Insight AI margine via Groq (PR #139, `1e8c12f`, ADR-0057)

**Secondo use case AI** dopo la bozza risposta (#136) — **entrambi sul `GroqService` ora generalizzato**. Sblocca l'insight differito in ADR-0054 §7 (precondizione: tariffario #127 che deriva `importoPrestazioni`). Read-only puro: nessuno schema/migration/seed/permesso.

- **`complete()` generico in `GroqService`**: core estratto in `complete(systemPrompt, userPrompt, { temperature?, maxTokens? })` (client lazy + chiamata + mappatura errori → 503 `E_AI_DISABLED`/`E_AI_EMPTY`/`E_AI_UPSTREAM`). `suggerisciRisposta()` (#136) delega ora a `complete()` — comportamento invariato, coperto dai test di regressione. Template riusabile per future feature AI.
- **`analizzaMargine(rows)`** sopra `complete()` (`temp 0.3`, `max_tokens 400`): **una sintesi globale** sull'intero set di mandati (non per-riga), ≤200 parole, italiano, analizza solo i mandati presenti (righe scoperte marcate `MANCANTE/PARZIALE`, senza caveat fantasma — corretto in runtime). Tipo `MargineRigaInsight` locale → niente dipendenza inversa `ai → report`.
- **Guard deterministico `< 2 mandati`**: `ReportService.margineInsight` short-circuita **prima** di Groq → `insight: null` + **`aiGenerated: false`** + `copertura` corretta (un'analisi comparativa su <2 mandati è rumore; su 1 mandato il modello divagava). Guard in `ReportService`, non in `GroqService` (resta wrapper AI puro). Risparmia la chiamata LLM.
- **`aiGenerated` flag → i18n FE**: le stringhe del path deterministico sono testo di prodotto IT/EN renderizzato dal FE, **non** hardcoded in italiano dal BE; solo la prosa AI (`aiGenerated:true`) resta italiano LLM-generato (effimero).
- **BE**: `POST /report/margine/insight` (azione → provider esterno) gated **`report.operativo.visualizza`** — **nessun permesso nuovo** (aggrega dati già accessibili via `GET /report/margine`). Ritorna `{ insight, aiGenerated, copertura: { totali, conPrestazioni } }`; copertura indipendente dal testo AI (disclaimer = fatto sui dati).
- **FE**: bottone "Analizza con AI" su `/report/margine` (gated `aiEnabled` via `GET /ai/status`, best-effort parallelo → fail-soft), box insight + **disclaimer copertura**, errore inline. Namespace `report` esteso IT↔EN in parità. **CI #139 verde**.

### NOVITÀ sessione 2026-06-30 — F2 Tavoli / Mappa sala — RESTAURANT RIATTIVATO (PR #138, `8a57b2b`, ADR-0058)

**Il verticale ristorazione è riattivato.** Primo dominio nuovo costruito sul core estratto (ADR-0027) dopo F1 Menu — valida la riusabilità di `packages/*` (api-client, auth, db/RLS, ui, i18n) su un secondo dominio-feature restaurant. La voce shell `mappa` era un `<PlaceholderPage>`. **Restaurant non è più scaffold congelato: è verticale attivo**, la prossima sessione restaurant riparte da qui.

- **Schema**: modello `Tavolo` (`numero`, `capienza`, `posX`/`posY` Float `@default(0)`, soft-delete) sotto confine DOMINIO + `Tenant.tavoli` back-relation. Migration `20260630120000_add_tavoli_models_f2_schema`: CREATE TABLE + index `tenant_id` + partial-unique soft-delete-aware `(tenant_id, numero) WHERE deleted_at IS NULL` + FK `ON DELETE CASCADE` + RLS `ENABLE`/`FORCE` + policy `tavoli_tenant_isolation` (pattern menu 1:1).
- **BE**: modulo `tables/` (controller + service + DTO + spec), REST `/tables` CRUD gated: GET → `tavoli.visualizza`, POST/PATCH/DELETE → `tavoli.gestisci`. Drag-drop persiste `posX`/`posY` via lo **stesso** `PATCH` (no endpoint posizione dedicato — YAGNI).
- **Permessi**: +2 `tavoli.{visualizza,gestisci}` → baseline array `PERMISSIONS` **58 → 60**. Assegnazione description-driven: `gestisci` → Direzione; `visualizza` → Direzione/Cassiere/Cameriere; Cucina/Bar esclusa; Super Admin + Admin sede via `ALL_PERMISSION_CODES`. **Questi permessi sono del verticale restaurant, non accountant.**
- **FE**: `mappa/page.tsx` — mappa sala drag-drop (token assoluti `posX`/`posY`, pointer events, persistenza on-drop ottimistica + rollback) + elenco accessibile (CRUD da tastiera/AT). Form `TableForm` (RHF + zod i18n). Namespace `tavoli` it↔en in parità (153/153).
- **E2E**: 3 spec Testcontainers (`tables-crud`, `tables-rbac`, `tables-tenant-isolation`) → **13 file e2e / 70 pass** (4 skip pre-esistenti TD-BS menu).
- **Tech debt (ADR-0058)**: 🆕 **TD-sala-forward** (`Sala`/`Zona` raggruppamento multi-piano, deferred — unico piano finché non implementato) · 🆕 **TD-tavolo-stato-forward** (stato libero/occupato/riservato, dipende da Comande S23+; `deletedAt` copre già "fuori servizio"). Entrambi BASSA severità, additivi.
- ⚠️ **Verifica runtime manuale FE non eseguita** (la PR #138 è verde su GATE statico + e2e, ma il giro manuale come non-superuser sulla mappa drag-drop resta da fare alla ripresa del verticale restaurant).

### Visione del verticale — tre livelli StudioDesk

1. **Operatore-studio** ✅ COMPLETO
2. **Cliente-dello-studio** ✅ COMPLETO (portale path-based)
3. **Super-admin** ✅ MINIMALE (lifecycle tenant, `oneplatform`)

### Prossimo — Onda 4 (in corso)

**Onda 3 COMPLETA. Onda 4 avviata: Task 3b tariffario ✅ (#127).** All'avvio sessione i container prod sono stati **rebuildati da `main`** (a `b1abe71` = Onda 3) — vedi nota deploy. Candidati Onda 4 restanti: superadmin monitoring (stato container/disk/memory), impersonation studio con banner, invito operatore via email. ✅ **Insight AI margine landed** (#139, ADR-0057 — era sbloccato dal tariffario, ADR-0054 §7). Residui Onda 3 non implementati (email notifiche, alert scadenze cron) da riallocare/confermare. **Parallelamente: verticale restaurant riattivato** (F1 Menu + F2 Tavoli #138) — arco separato dall'Onda 4 accountant.

### Fili aperti

- **`STUDIO_DESK.md` extension**: aggiungere sezione AI, cron inventory, feature map per pannello (admin/superadmin/public → stato in gestionale). Da fare prima dell'Onda 3 completa.
- ~~**Nuova chiave Groq** da inserire in `.env`~~ ✅ inserita (Slice A AI draft #136); riusabile per future feature AI (insight margine, ecc.).
- **Subdomain routing** (`[slug].studiodesk.cloud` per portale cliente): task infra futuro.
- **UI configurazione identità tenant**: oggi solo seed/superadmin. Quando uno studio pilota chiede di cambiare logo/descrizione, serve form in `/platform/tenants/[id]`.
- **Template landing**: betadesk aveva 6 template con stili diversi. Deferred — costruire quando lo studio pilota lo chiede.
- **Invito operatore** via email (oggi solo seed manuale): Onda 4.

### Tech debt aperti

Invariati: **TD-BV** · **TD-CB** · **TD-PATCH-null-FK** · **TD-blocklist-drift** · **`web` external one-time** · **TD-documenti-tipo-codice** · **TD-utente-enum-forward** · **TD-storage-gc** · **TD-moduleResolution-node10** · **TD-circolari-utente-forward** · **TD-portale-com-allegati** · **TD-portale-com-apertura** · **TD-portale-circolari-html** · **TD-immagine-api**.
Nuovi Onda 3:

- ~~**TD-i18n-zod**~~ ✅ **RISOLTO** (#134): messaggi di validazione zod ora i18n it/en su 6 superfici (schema in `useMemo`+`t()`, namespace `validation` per area, 605 chiavi in parità). Vedi NOVITÀ #134.
- ~~**TD-i18n-cumulativo**~~ ✅ **RISOLTO** (#129): pagine `/catalogo`, `/mandati`, `/report/margine` + timesheet `PrestazioniSection` ora i18n it/en (namespace `catalogo`/`mandati`/`report`/`prestazioni`, 577 chiavi in parità).
- ~~**TD-voceId-FE**~~ ✅ **RISOLTO** (#132): select "Voce di preventivo" nel form prestazioni + colonna "Voce" in tabella (ADR-0053 sub-DP). Riusa `getPreventivo` per le opzioni, nessun endpoint nuovo.
- ~~**TD-tariffario**~~ ✅ **RISOLTO** (#127, ADR-0055): tariffario per ruolo/utente → `Prestazione.importo` derivato (`ore × tariffa`). Ha sbloccato gli **insight AI margine** ✅ landed (#139, ADR-0057).

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

- **Main @ `8a57b2b`** (+1 commit `docs(handoff)` in arrivo via PR). Cronologia recente:
  - `8a57b2b` feat(tavoli): F2 Tavoli / Mappa sala drag-drop (ADR-0058) (#138)
  - `1e8c12f` feat(report): insight AI margine via Groq (ADR-0057) (#139)
  - `1c0280d` docs: aggiorna HANDOFF + PROGRESS — bozza AI risposta operatore (#136) (#137)
  - `b18cfae` feat(comunicazioni): bozza AI risposta operatore via Groq (ADR-0056) (#136)
  - `735743f` feat(i18n): traduzione IT/EN messaggi validazione zod form operatore + login (#134)
  - `75476fc` feat(prestazioni): picker voce di preventivo nel timesheet + colonna Voce (#132)
- **Working tree PULITO**, nessun branch pendente. Lavoro sequenziale (no worktree): disciplina = working tree pulito a fine sessione.
- ADR in repo fino a **0058** (0054 report margine · 0055 tariffario orario · 0056 AI draft risposta · **0057 insight AI margine** · **0058 tavoli/mappa sala F2**). i18n #129, voce-picker #132 e i18n-zod #134 sono chiusure TD, senza ADR.
- ⚠️ **Stato deploy**: i container prod (`accountant-api`/`-web`) sono allineati a **`0093b79`** (rebuild sessione deploy: insight AI margine **#139** + AI draft #136 + tariffario #127 + i18n #129/#132/#134); health `ok`/`db:connected`, `GROQ_API_KEY` in `.env` (feature AI attiva). L'**insight AI margine (#139)** è **in prod** (verificato end-to-end via Caddy `https://studiodesk.cloud/api/v1/health`). Il **verticale restaurant** è ora **deployato dietro Caddy su `food.studiodesk.cloud`** (`feature/deploy-restaurant`): `restaurant-api` (3004) + `restaurant-web` (3005) sullo stesso DB `gestionale`, site block Caddy dedicato (host esatto, precede il wildcard accountant), verificato end-to-end (`food.studiodesk.cloud/api/v1/health` → `ok`/`db:connected`, accountant intatto). Il deploy ha reso restaurant production-ready (era dev-only): build swc, `tsconfig.build.json`, `output:'standalone'`, `public/`.
- 🗄️ **Un solo database, schema/migration history unica (NON "due DB").** Esiste un unico database `gestionale` nel container `gestionale_postgres`; lo schema Prisma `packages/db/prisma/schema.prisma` è **condiviso** tra accountant e restaurant (entrambi consumano `@gestionale/db`) → **una sola migration history**. La migration tavoli `20260630120000` è stata applicata su `gestionale` (la tabella `tavoli` vive lì): `prisma migrate deploy` applica tutte le pending della history condivisa, non è separabile per verticale. La tabella è additiva e RLS-isolata, innocua per l'app accountant che non la usa. Il vecchio modello mentale "DB restaurant separato dal DB accountant" era **errato**.

### Schema dominio accountant — aggiornato

`Azienda` · `Referente` · `Preventivo` + `PreventivoVoce` · `Scadenza` + `ScadenzaCategoria` · `Comunicazione` + `ComMessaggio` + `ComAllegato` · `DocumentoTipo` + `Documento` · `Circolare` + `CircolareDestinatario` + `CircolareLettura` · `User` (con `UserTipo`, `ClienteRuolo`, `aziendaId`) · **`PasswordReset`** · **`ClienteInvito`**. CHECK constraint `chk_cliente_azienda_id`.

`Tenant` aggiornato: +`descrizione`, +`indirizzo`, +`telefono`, +`emailContatto`, +`sitoWeb`, +`logoUrl` (tutti nullable, migration `20260625124846_add_tenant_identity`).

**Catalogo servizi (ADR-0050)**: `ServizioCategoria` + `ServizioCatalogo` (`tenantId` nullable platform/custom, no RLS) · enum `TipoRicorrenza` · `PreventivoVoce.servizioId` (FK SetNull) · partial unique index `(tenant_id, nome|codice) WHERE tenant_id IS NOT NULL`. Seed: 6 categorie + 20 voci piattaforma.

**Mandati/Prestazioni (ADR-0051/0053)**: `Mandato` (RLS FORCE, `importoConcordato` snapshot, partial-unique `preventivo_id WHERE deleted_at IS NULL`) + `RdlCounter` (counter per-tenant per-anno) + enum `StatoMandato` · `StatoPreventivo` esteso con `convertito` · `Prestazione` (RLS FORCE, `mandatoId` CASCADE, `voceId`/`userId` SetNull, `ore` req / `importo` nullable). Migration `add_mandati`, `add_prestazioni`. Report margine (ADR-0054): nessuno schema (aggregazione read-only).

**Tariffario (ADR-0055)**: `TariffaOraria` (`tariffe_orarie`, RLS FORCE) — `roleId?`/`userId?` (scope XOR via CHECK `tariffe_orarie_scope_xor`), `tariffaOraria Decimal(10,2)`, `attivo`, soft-delete; **2 partial-unique** `(tenant_id, role_id|user_id) WHERE ... IS NOT NULL AND deleted_at IS NULL`; FK tenant/role/user CASCADE. Migration `20260629090933_add_tariffe_orarie`. Deriva `Prestazione.importo` (nessuna colonna nuova su `Prestazione`).

### Permessi (60 su `main` = 58 accountant + 2 tavoli restaurant)

> Baseline su `main` = **60** (lunghezza array `PERMISSIONS` / log seed `Permissions: N attese` / count DB). **NON usare `grep -c "code:"`** (sovrastima — conta match non-array). Regola anti-miscount in ADR-0052 / memoria `reference_permission_count_baseline`. Progressione: 50 → 52 (`servizi.*`, #120) → 54 (`mandati.*`, #122) → 56 (`prestazioni.*`, #124) → 58 (`tariffario.*`, #127) → **60 (`tavoli.*`, #138)**. I 2 `tavoli.{visualizza,gestisci}` appartengono al **verticale restaurant** (non accountant); il perimetro funzionale accountant resta **58** (insight AI margine #139 riusa `report.operativo.visualizza`, nessun permesso nuovo).

Namespace studio: `aziende.*` · `referenti.*` · `preventivi.*` · `scadenze.*` · **`servizi.{visualizza,gestisci}`** · **`mandati.{visualizza,gestisci}`** · **`prestazioni.{visualizza,gestisci}`** · **`tariffario.{visualizza,gestisci}`** · `report.*` · `comunicazioni.*` · `documenti.*` · `circolari.*` · `sistema.*` · **`clienti.invitare`**.
Namespace portale: `portale.documenti.visualizza` · `portale.comunicazioni.{visualizza,rispondi}` · `portale.circolari.visualizza`.
Template "Cliente" → 4 permessi portale. `servizi.visualizza`, `mandati.*` e `prestazioni.*` anche al Collaboratore; `prestazioni.*` anche al Praticante. `tariffario.*` **solo** ai ruoli con `ALL_PERMISSION_CODES` (Super Admin/Admin sede/Socio — dati di costo sensibili). Report margine **e insight AI margine (#139)** riusano `report.operativo.visualizza` (nessun permesso nuovo).
Namespace **restaurant** (verticale ristorazione): **`tavoli.{visualizza,gestisci}`** (#138, ADR-0058) — `gestisci` → Direzione; `visualizza` → Direzione/Cassiere/Cameriere (Cucina/Bar esclusa).

### Stack & ambiente

- NestJS 11, Next.js 15 (standalone), Prisma 6, PostgreSQL 16 (RLS), Redis, Vitest, Testcontainers, Playwright, Tailwind, shadcn/ui, Inter font.
- Server Hetzner `gestionale-test`. Docker Compose (`dev.yml` + `prod.yml`). Caddy custom (wildcard cert `*.studiodesk.cloud`, DNS-01 Cloudflare).
- **App containerizzate e live**: `gestionale-accountant-api-1` + `gestionale-accountant-web-1`.
- Tenant demo: `studio-demo` (= Studio Ferretti & Lombardi, dati identità popolati) + `studio-acme` + **`oneplatform`** (superadmin piattaforma).
- Utenti demo: `admin@studio.local / Studio123!` · `collaboratore@studio.local / Collaboratore123!` · `cliente@studio-demo.local / Cliente123!` · `superadmin@oneplatform.local / Superadmin123!`.
- Landing pubblica: `https://studiodesk.cloud/t/studio-demo` (no login richiesto).
- Betadesk: `/home/deploy/projects/betadesk` — READ-ONLY, riferimento legacy.

### Verifica finale richiesta a Code (chiusura sessione)

Working tree pulito, main @ `8a57b2b` allineato origin, nessun branch pendente. PROGRESS.md aggiornato con entry [2026-06-29] **insight AI margine (#139, ADR-0057)** + [2026-06-30] **F2 Tavoli / Mappa sala (#138, ADR-0058)**. Baseline permessi su `main` = **60** (58 accountant + 2 `tavoli.*` restaurant). Container prod accountant fermi a `b18cfae` (insight #139 da rideployare con un rebuild; restaurant #138 non deployato). Verticale restaurant **riattivato**.

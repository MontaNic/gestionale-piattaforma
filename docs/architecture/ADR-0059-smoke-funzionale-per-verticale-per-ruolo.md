# ADR-0059 — Smoke test funzionale per-verticale per-ruolo (gate post-deploy)

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** Task #2 dei task aperti 2026-06-30 (gap di processo emerso dal bug "tavoli 403")
- **Predecessor:** [ADR-0016](./ADR-0016-playwright-e2e-frontend-ci.md) (foundation Playwright E2E + storage state pattern), [ADR-0058](./ADR-0058-tavoli-mappa-sala-f2.md) (F2 Tavoli — il cui 403 ha motivato lo smoke)
- **Branch:** `feature/smoke-per-verticale-ruolo`

## Context

Il bug "tavoli 403" (un Super Admin senza il permesso `tavoli.visualizza` nel DB → 403 sulla pagina `mappa`) è sfuggito al GATE statico e agli e2e Testcontainers: nessuno faceva il **giro reale delle pagine autenticate come un ruolo reale contro l'ambiente reale**. Gli e2e esistenti (ADR-0016) sono funzionali-locali, mirati (1-2 rotte/test), e girano contro un DB di test effimero — non contro il DB prod dove il dato-permesso può divergere dal seed.

Serve un **gate post-deploy**: dopo ogni deploy, un giro automatico che logga come ogni ruolo seedato e visita ogni pagina a cui quel ruolo ha accesso, fallendo su 403/500/crash. Il giro del solo Super Admin avrebbe pescato il 403 tavoli.

## Decision

Smoke test funzionale **per-verticale per-ruolo** in Playwright, con tre invarianti fondanti:

1. **READ-ONLY ASSOLUTO.** Gira contro gli **URL pubblici** (`studiodesk.cloud`, `food.studiodesk.cloud`) → **DB prod condiviso**. Ammessi solo `POST /api/v1/auth/login` (per il token) e `GET` durante la navigazione. Ogni metodo mutante (POST≠login / PUT / PATCH / DELETE) è bloccato da un **guard attivo** (`page.route` → `route.abort()`): la mutazione non lascia nemmeno il browser, e la sua comparsa fa **fallire** il test. È questa proprietà che rende sicuro girare contro prod.
2. **On-demand, NON CI-bloccante.** Gira contro prod live → non va raccolto dal job di test CI. Isolato dietro config dedicate `playwright.smoke.config.ts` invocate solo via `pnpm test:e2e:smoke` (non è una task turbo); la config CI funzionale (`playwright.config.ts`) fa `testIgnore` di `page-tour.spec.ts`.
3. **Tour = pagine accessibili per-ruolo.** L'insieme di pagine visitate da un ruolo = le pagine a cui ha **legittimamente** accesso (per Super Admin = tutte). Questo evita di mantenere una matrice atteso-permesso/atteso-negato: ogni pagina del tour **deve** caricare senza 403, perché è una pagina che il ruolo dovrebbe vedere. Un 403 lì = il bug che cerchiamo.

### Architettura

- **Manifest** (`e2e/page-manifest.ts`, uno per verticale) = single source of truth del tour: per ruolo, pagine statiche + strategie di risoluzione delle dinamiche (`[id]` risolte navigando l'index e seguendo il primo link di dettaglio; lista vuota → skip con log). Derivato empiricamente da `NAV_ITEMS` delle sidebar + `page.tsx` + permessi-ruolo del seed.
- **auth.setup** per profilo-ruolo → uno `storageState` per (tenant, ruolo) in `.auth/<profile>.json` (gitignored). L'auth è **localStorage** (`gestionale_access_token`/`refresh_token`), non cookie → lo state cattura localStorage.
- **page-tour.spec** parametrizzato (ruolo × pagina). Asserzioni di fallimento: (a) response — documento o XHR `/api/*`, stesso host — con status **403** o **≥500**; (b) `pageerror`; (c) fallback Next "client-side exception has occurred" (non esiste un `error.tsx` applicativo → marker reale, vedi TD); (d) richiesta mutante intercettata.
- **Scaffold accountant**: il verticale non aveva infra e2e → replicato il pattern restaurant (ADR-0016): `playwright.smoke.config.ts` + `e2e/auth.setup.ts` + `.env.e2e.example`.

### Copertura Fase 1

| Verticale  | Ruolo         | Utente seed                        | Tour                                      |
| ---------- | ------------- | ---------------------------------- | ----------------------------------------- |
| accountant | Super Admin   | `admin@studio.local` (studio-demo) | tutte le pagine shell back-office         |
| accountant | Collaboratore | `collaboratore@studio.local`       | pagine con permesso di view posseduto     |
| accountant | Cliente       | `cliente@studio-demo.local`        | superficie portale                        |
| restaurant | Super Admin   | `admin@demo.local` (demo)          | tutte le pagine shell (incl. placeholder) |

Run reale (post-deploy 2026-06-30): **restaurant 10/10 PASS** (incl. `mappa`/tavoli → il 403 originale è risolto), **accountant 32/32 PASS** dopo l'esclusione documentata (sotto). Il guard ha bloccato 3 mutazioni reali su prod (mark-as-read), **zero scritture**.

## Consequences

### Positive

- Gate post-deploy che pesca la classe-bug "ruolo reale × pagina reale × dato-permesso prod" non coperta da statico/e2e effimeri.
- Read-only verificato attivamente → sicuro contro prod, riproducibile dopo ogni deploy con `pnpm smoke`.
- Il tour ha già pescato un finding architetturale reale (mutate-on-view, sotto).

### Limiti noti

- **Copertura 3/11 ruoli template.** Solo Super Admin, Collaboratore, Cliente hanno utenti seedati. Gli 8 ruoli template restanti (Admin sede, Direzione, Cassiere, Cameriere, Cucina/Bar, Socio, Segreteria, Praticante) non hanno utente con cui loggare → non coperti. Estendere il seed si intreccia col **task #1** (propagazione permessi template→tenant) e va trattato lì, non qui.
- **`platform/tenants` non coperta.** È tenant-gated (solo `oneplatform`), non role-gated: su `studio-demo` non compare. La copertura richiede un **mini-giro Fase 2 su `oneplatform`** con `superadmin@oneplatform.local` (utente già seedato).
- **2 detail comunicazioni escluse dal tour** (`comunicazioni/[id]` operatore + `portale/comunicazioni/[id]` cliente): fanno mark-as-read al mount → mutate-on-view, incompatibili con il read-only assoluto e non-deterministiche. Le rispettive index/liste restano coperte. Pattern catturato come TD (sotto).

### Tech debt registrati (da questo task)

- **TD-no-error-boundary** — nessun `error.tsx`/`global-error.tsx` in entrambi i verticali: un client component che lancia mostra il fallback grezzo di Next ("client-side exception has occurred"), non una UI di errore controllata. Lo smoke usa quel fallback come marker. BASSA severità; da registrare, non fixare qui.
- **TD-sidebar-permission-filter** — la sidebar accountant filtra per permesso **solo `tariffario`**; le altre voci gated (es. `report/margine`, che richiede `report.operativo.visualizza`) restano esposte a ruoli senza il view → portano all'alert "permesso mancante" (corretto ma incoerente). BASSA severità.
- **TD-comunicazioni-mutate-on-view** — il dettaglio comunicazione esegue una mutazione al mount (operatore: `POST /api/v1/comunicazioni/<id>/letto`; portale: `PATCH /api/v1/portale/comunicazioni/<id>/letto-cliente`). Implicazioni oltre lo smoke: non idempotente su refresh, side-effect su semplice apertura, problematico per prefetch/link-preview. TD di **design** (non un blocker).

## Note operative

Lo smoke richiede: `.env.e2e` popolato (creds seed deterministiche, gitignored) + prod up + target via default della smoke config (override con `PLAYWRIGHT_BASE_URL`). Comandi: `pnpm smoke` (entrambi), `pnpm smoke:accountant`, `pnpm smoke:restaurant`.

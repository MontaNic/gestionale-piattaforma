# ADR-0022 — F1 Listini UI: PriceList CRUD + ArticlePrice override (S20)

- **Status:** Accepted
- **Date:** 2026-05-22 (sessione 20)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0020](./ADR-0020-f1-menu-ui-crud.md) (Menu UI S19 — §prezzo DP-3 differiva `ArticlePrice`/listini a S20; pattern routing/data-fetch/form riusati), [ADR-0019](./ADR-0019-f1-menu-crud-schema.md) (schema + endpoint REST `/price-lists` e `/articles/:articleId/prices` consumati), [ADR-0021](./ADR-0021-soft-delete-rls-tx-escape-fix.md) (soft-delete RLS-aware — il GATE runtime gira sotto ruolo `gestionale_app` non-superuser), [ADR-0018](./ADR-0018-f1-shell-ui-foundation.md) (`lib/error-codes.ts`, i18n next-intl)

## ✅ Status finale

**Menu domain UI completato sessione 20:** la gestione listini chiude il carving F1 Menu UI iniziato con S19. Nuova route tenant-level `(authenticated)/menu/listini` (CRUD `PriceList`) + sezione "Prezzi per listino" on-demand nel detail menu (override `ArticlePrice` per articolo). **Nessuna modifica backend / schema / migration** — consumati gli endpoint S17 (ADR-0019).

- Modello prezzo **Opzione 1** (confermato owner): `Article.basePrice` = default/fallback, `ArticlePrice.price` = override puntuale per (articolo × listino).
- **Resolution display-only (Opzione 1a):** la UI calcola `override ?? basePrice`; il backend resta invariato (nessun pricing resolution server-side → TD-BY).
- `lib/menu-api.ts` esteso (+9 funzioni: 5 `PriceList` + 4 `ArticlePrice`); `lib/menu-types.ts` esteso (`PriceList`, `ArticlePrice`, `Channel`, input types).
- **Scope-adjacent fix** (Pattern 25) di `lib/api.ts` `parseError`: srotola il wrapper `E_VALIDATION` → vedi §parseError.
- GATE runtime (Pattern 40): smoke contratto API **22/22**, driver UI Playwright headless **23/23** sotto ruolo `gestionale_app` non-superuser. typecheck + lint + `next build` clean.

## Context

S19 (ADR-0020) ha lasciato esplicitamente fuori scope la gestione listini: §prezzo DP-3 differiva `ArticlePrice` e il CRUD `price-lists` a S20, gestendo solo `Article.basePrice`. S20 completa il Menu domain UI con i listini.

**STOP 0 — verifica empirica schema prezzi (READ-ONLY).** Prima di disegnare la UI è stata riconciliata la semantica `Article.basePrice` ↔ `ArticlePrice`/`PriceList`:

- `Article.basePrice` `Decimal(10,2)` NOT NULL, required in `CreateArticleDto`.
- `ArticlePrice` = join puro `Article`↔`PriceList` con `price Decimal(10,2)`, `@@unique([articleId, priceListId])`, **no soft-delete** (hard delete, FK `Restrict`).
- `PriceList` segmentata per `channels Channel[]` (`cassa | menu_online | asporto | delivery`) — **nessun enum "tipo listino"**.
- A runtime i due sono **disaccoppiati**: nessun codice backend lega `basePrice` e `ArticlePrice`; un articolo può avere 0 override. Il seed crea `ArticlePrice` con `price == basePrice` sul listino "Base" solo per convenzione, non per vincolo.

**STOP 1 — scope chiuso** sul modello prezzo Opzione 1 + resolution display-only 1a. **Task 1 — verifica empirica frontend (Pattern 36):** confermati i 3 assunti core (api.ts 4 verbi; `menu-api.ts` 13 funzioni senza prezzi/listini; pattern stato locale + refetch). 4 divergenze emerse e tutte Accept dall'owner (vedi §Decisions).

## Decisions

### DP-1 — Modello prezzo Opzione 1 + resolution display-only (Opzione 1a)

**Semantica (eredità ADR-0020 §modello prezzo Opzione B):**

- `Article.basePrice` è la **source-of-truth di default/fallback** del prezzo articolo.
- `ArticlePrice.price` è un **override puntuale** per la coppia (articolo × listino).
- Il prezzo applicato su un listino = `override ?? basePrice`.

**Opzione 1a — resolution SOLO lato UI display.** Il backend S20 resta **invariato**: nessun pricing resolution server-side. La sezione "Prezzi per listino" calcola e mostra il prezzo applicato; nessun consumer backend conosce il prezzo risolto. Questo è un confine esplicito → **TD-BY** (pricing resolution backend).

### DP-2 — Anti-drift: assenza override = "usa basePrice", nessun override ridondante

L'**assenza** di una riga `ArticlePrice` per (articolo, listino) è uno **stato valido e significativo**: vuol dire "su questo listino usa il prezzo base". La UI **non crea mai** un override automatico (es. non forza un `ArticlePrice` sul listino "Base" pari a `basePrice`). Rimuovere un override (DELETE) riporta la riga a mostrare `basePrice`. Questo evita la deriva "ogni articolo × ogni listino = una riga" che renderebbe `basePrice` un campo morto.

> Nota: il **seed** popola `ArticlePrice` sul listino "Base" con `price == basePrice` — quei record pre-esistenti compaiono come "override" (valore numericamente uguale al base). È dato di seed, non comportamento della UI S20; la UI non ne genera di nuovi.

### DP-3 — Route listini: tenant-level, segment statico `menu/listini`

I listini **non sono per-singolo-menu** → route tenant-level `(authenticated)/menu/listini/page.tsx`. Il segment statico `listini` ha **precedenza** sul dinamico fratello `[menuId]` (Next.js App Router) → nessuna collisione: `/t/<slug>/menu/listini` risolve sempre la pagina listini.

**Entry-point (divergenza D3, Accept):** la `Sidebar` ha `NAV_ITEMS` come union tipata fissa di 8 voci — aggiungere uno slot "listini" sarebbe scope creep su una foundation condivisa. Scelto invece un link "Listini" nell'header della pagina lista menu. Limitazione nota: la sub-route resta non evidenziata in Sidebar — è il già noto **TD-BU** (carry-over S19, non nuovo TD).

### DP-4 — UI override: `ArticlePricesSection` toggled, non dentro `ArticleForm`

S19 non ha una "article detail view": gli articoli si gestiscono inline in `CategorySection` (riga lista + `ArticleForm` RHF toggled per l'edit). La sezione prezzi è un **componente separato** `ArticlePricesSection`, aperto on-demand da un bottone "Prezzi" per articolo in `CategorySection` (divergenza D4, Accept).

Razionale: annidare il CRUD async degli override dentro `ArticleForm` (un `<form>` RHF) darebbe form annidati ed è impossibile su un articolo non ancora creato. La sezione separata:

- è coerente col pattern S19 "dati nel parent, refetch on mutation" — i `PriceList` attivi sono caricati una volta nel `load()` del detail menu e passati giù;
- fa **lazy fetch** degli `ArticlePrice` del singolo articolo all'apertura (evita N+1 eager su tutta la lista articoli);
- mostra la resolution **on-demand**, coerente con Opzione 1a (display-only, non eager).

### DP-5 — §parseError: scope-adjacent fix del wrapper `E_VALIDATION`

**Finding emerso dal GATE runtime** (Pattern 40 — colpendo il caso complesso, non l'happy path). Il `GlobalHttpExceptionFilter` backend (ADR-0012 §TD-AY) avvolge gli errori di validazione DTO con `errorCode: 'E_VALIDATION'` e mette il codice **specifico** in `message: string[]` (un errorCode taxonomy per campo fallito). Il frontend `parseError` ([lib/api.ts](../../apps/web/src/lib/api.ts)) leggeva solo `body.errorCode` → otteneva il generico `E_VALIDATION` → non in tabella → fallback "Si è verificato un errore". **Tutti** gli errori di validazione DTO app-wide (non solo S20) cadevano sul messaggio generico — mascherato finora perché la validazione zod client-side intercettava la maggior parte prima del backend.

**Decisione:** fixare `parseError` — quando `errorCode === 'E_VALIDATION'` e `message` è un array, promuovere `message[0]` a errorCode effettivo (difensivo: solo se è un taxonomy code `^E_[A-Z…]`, altrimenti resta `E_VALIDATION` → messaggio i18n dedicato).

Trattato come **scope-adjacent fix in PR feature** (Pattern 25): costo trivial, layer condiviso, sblocca un blocker concreto del GATE (item 5 — "errorCode backend renderizzato come messaggio i18n"). L'alternativa (validazione client-side che aggira il backend) è stata **scartata**: aggirerebbe il GATE invece di soddisfarlo, lasciando il path backend→render rotto app-wide (anti-pattern over-claim).

**3 condizioni anti-regressione verificate prima del fix (Pattern 38):**

1. **Shape reale** — verificato empiricamente su 5 path (price-lists, articles, basePrice, **auth/login**): ogni risposta `E_VALIDATION` ha `message[]` = array di errorCode taxonomy, nessuna stringa human. Extra-field non-whitelisted → strip silenzioso (no `forbidNonWhitelisted`), nessun messaggio human. Il fix è comunque difensivo sul caso teorico.
2. **Nessun consumer** — `grep` confermato: nessun punto di `apps/web` legge `errorCode === 'E_VALIDATION'` come ramo intenzionale.
3. **Micro-gate non-regressione** — verificato a runtime che un errore service-thrown S19 (`E_MENU_NAME_EXISTS`, 409 con `errorCode` diretto) resta specifico dopo il fix: il ramo `body.errorCode` non regredisce. Il fix agisce **solo** su `E_VALIDATION`, che prima cadeva al 100% sul fallback → non può regredire nulla.

## §Finding — TD-BZ: soft-delete vs `@@unique([tenantId, name])`

Emerso dal GATE runtime. `PriceListsService.create` ([price-lists.service.ts:50](../../apps/api/src/price-lists/price-lists.service.ts)) fa il pre-check di unicità nome con `findFirst`, che la `softDeleteExtension` filtra escludendo le righe soft-deleted. Ma il vincolo DB `@@unique([tenantId, name])` **include** le righe soft-deleted → ricreare un listino con il nome di uno già soft-deleted: il pre-check passa, poi `create()` viola il constraint → `P2002` non gestito → HTTP 500 → la UI mostra l'errore generico.

**Pattern latente nell'intero dominio:** stesso schema (`@@unique([tenantId, name…])` + pre-check `findFirst`) su Menu, MenuCategory, Article. **Backend, pre-esistente S17, fuori scope S20** (NO backend-touch) → catturato come **TD-BZ**.

**Confine:** finché TD-BZ non è risolto, ogni "ricrea un'entità con il nome di una soft-deleted" → HTTP 500 generico in UI. La UI S20 si comporta correttamente (POST valido, errore renderizzato) — il difetto è backend.

## Tech debt

### TD-BY — Pricing resolution backend (`override ?? basePrice` server-side)

Categoria: **feature backend mancante**. La resolution `override ?? basePrice` per canale esiste **solo** nella UI display S20 (Opzione 1a). **Confine:** finché TD-BY non è implementato, nessun consumer backend (futuri Cassa / Comande, S23+) conosce il prezzo applicato su un canale — solo la UI lo calcola. Fix: pricing resolution server-side (dato (articolo, canale/listino) → prezzo applicato), additivo, ~2-3h. Severità MEDIA.

### TD-BZ — Soft-delete vs `@@unique([tenantId, name])` → P2002/500 sul riuso nome

Categoria: **bug backend**. Vedi §Finding. Ricreare un'entità (`PriceList`, e per lo stesso pattern `Menu`/`MenuCategory`/`Article`) con il nome di una soft-deleted → `P2002` non gestito → HTTP 500 generico. Fix possibili: includere `deletedAt` nel pre-check + risposta `E_*_NAME_EXISTS` pulita, oppure unique parziale `WHERE deleted_at IS NULL`, oppure consentire il riuso. Severità MEDIA, backend, ~1-2h.

## Conventions

### Multi-select enum: checkbox native (no nuova dipendenza)

`PriceList.channels` è un multi-select su `Channel`. Confine "nessuna nuova dipendenza" (come S19 per `<select>`): reso con `<input type="checkbox">` native dentro `FormControl`, `field.value` array di `Channel`. Stesso pattern del checkbox `isActive` di `MenuForm`.

### Validazione prezzo override: client minimale, range al backend

L'input override fa validazione client **solo di formato** (vuoto / non-numerico → `prices.invalidFormat` i18n). Range e precisione (negativi, >2 decimali) sono lasciati al backend → l'errorCode emesso viene reso via `messageForError` (i18n). Scelta deliberata per esercitare il path backend→render (GATE item 5) — resa funzionante dal fix §parseError.

### i18n: namespace `menu` esteso

Aggiunte le sotto-chiavi `listini.*`, `prices.*`, `channels.*` + campi `fields.*` e `confirm.*` al namespace `menu` esistente in `it.json` + `en.json`. Messaggi di validazione zod IT inline (coerente con S19).

## Files

### Nuovi file

| Path                                                              | Ruolo                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/web/src/components/menu/PriceListForm.tsx`                  | Form create/edit `PriceList` (RHF + zod, multi-select channels)        |
| `apps/web/src/components/menu/ArticlePricesSection.tsx`           | Sezione override prezzi per articolo (lazy fetch + resolution display) |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/listini/page.tsx` | Lista + CRUD `PriceList` (route tenant-level)                          |
| `docs/architecture/ADR-0022-f1-listini-ui.md`                     | questo file                                                            |

### File modificati

| Path                                                               | Cosa cambia                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `apps/web/src/lib/menu-types.ts`                                   | +`PriceList`/`ArticlePrice`/`Channel` + input types                     |
| `apps/web/src/lib/menu-api.ts`                                     | +9 funzioni (`PriceList` CRUD + `ArticlePrice` set/update/delete/list)  |
| `apps/web/src/lib/api.ts`                                          | §parseError — unwrap `E_VALIDATION` → `message[0]` (scope-adjacent fix) |
| `apps/web/src/lib/error-codes.ts`                                  | +mapping `E_VALIDATION` (fallback difensivo)                            |
| `apps/web/src/components/menu/CategorySection.tsx`                 | +bottone "Prezzi" per articolo → `ArticlePricesSection` toggled         |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/page.tsx`          | +link "Listini" nell'header                                             |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/[menuId]/page.tsx` | +fetch `PriceList` attivi, passati a `CategorySection`                  |
| `apps/web/src/i18n/messages/it.json` / `en.json`                   | +chiavi `listini`/`prices`/`channels`                                   |
| `PROGRESS.md`                                                      | entry sessione 20                                                       |

## GATE — verifica (Pattern 40)

Verifica runtime obbligatoria contro lo stack reale (DB + API + web), API connessa come ruolo **`gestionale_app` non-superuser** (RLS `FORCE` attiva).

- **Smoke contratto API** (utente reale, JWT): **22/22 PASS** — CRUD `PriceList`, override set/update/delete, resolution, errorCode validazione, soft-delete.
- **Driver UI Playwright headless chromium** (login `admin@demo.local`, driver ad-hoc non committato come S19): **23/23 PASS** — i 7 item del GATE:
  - CRUD listino (create ≥2 canali, persist reload, edit priority, soft-delete con `ConfirmDialog`);
  - override prezzo (set, persist reload);
  - resolution display (`prezzo base` senza override / `override` con override; override colpisce solo il listino target);
  - rimozione override → torna a `basePrice` (no `ArticlePrice` residuo);
  - errorCode prezzo invalido → messaggio i18n specifico ("Prezzo non valido…", post fix §parseError);
  - deep-link diretto `/menu/listini` e `/menu/[menuId]`;
  - light/dark leggibili;
  - micro-gate non-regressione (`E_MENU_NAME_EXISTS` S19 resta specifico).
- typecheck workspace + lint (`eslint` + `next lint`) + `next build`: **clean** (route `/t/[slug]/menu/listini` generata).
- Unit/E2E backend: **non impattati** — S20 modifica solo `apps/web`.

## Definition of Done F1 Listini UI (S20)

- [x] STOP 0 — verifica empirica schema prezzi (READ-ONLY)
- [x] Task 1 — verifica empirica frontend (Pattern 36), 4 divergenze Accept
- [x] Task 2 — data layer client (`menu-types.ts` + `menu-api.ts`)
- [x] Task 3 — UI gestione listini (PriceList CRUD)
- [x] Task 4 — UI override prezzi per articolo (resolution display 1a)
- [x] Task 5 — errorCode (verify-only, già presenti S17) + i18n + permission gating
- [x] Task 6 — GATE verifica manuale runtime (Pattern 40): API 22/22 + UI 23/23
- [x] §parseError scope-adjacent fix (Pattern 25) con 3 condizioni anti-regressione (Pattern 38)
- [x] ADR-0022 + PROGRESS.md aggiornati; TD-BY documentato, TD-BZ catturato
- [ ] HEAD main avanzato via squash merge PR (owner da UI)

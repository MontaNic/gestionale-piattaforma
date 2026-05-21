# ADR-0020 — F1 Menu UI: list + detail CRUD (S19)

- **Status:** Accepted
- **Date:** 2026-05-22 (sessione 19)
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0018](./ADR-0018-f1-shell-ui-foundation.md) (shell UI foundation — route group `(authenticated)`, AuthContext, i18n next-intl, `lib/error-codes.ts`), [ADR-0019](./ADR-0019-f1-menu-crud-schema.md) (F1 Menu CRUD schema + backend — endpoint REST consumati), [ADR-0012](./ADR-0012-frontend-auth-flow.md) (frontend auth flow — TD-1 localStorage JWT, pre-condizione)

## ✅ Status finale

**Prima UI feature business completata sessione 19:** la route `(authenticated)/menu/` passa da placeholder "Coming soon" a list + detail con CRUD Menu / Categorie / Articoli, consumando gli endpoint backend S17 (ADR-0019). **Nessuna modifica backend / schema / migration.**

- Routing 2-livelli: `menu/page.tsx` (list) + `menu/[menuId]/page.tsx` (detail) — **primo segment dinamico `[id]` del progetto**.
- Data access client `lib/menu-api.ts` sopra i wrapper `lib/api.ts` estesi (`apiPatch` + `apiDelete` aggiunti). NO react-query / SWR / Server Actions — stato React locale + refetch on mutation.
- Form: RHF + zodResolver + `components/ui/form.tsx` (pattern `login/page.tsx`). Errori server via `messageForError` + `<Alert variant="destructive">` inline.
- Permission gating bottoni (branch A5): `menu.categoria.gestisci`, `menu.piatto.crea`, `menu.piatto.modifica`.
- Soft-delete con dialog di conferma (nuovo primitive `ui/dialog.tsx`); nessun cestino/ripristino UI (TD-BQ).
- GATE: `pnpm -w test` unit 91/91 (invariato), `typecheck` clean, `lint` clean (root `eslint .` + `next lint`), `next build` OK (13 route). Playwright non rieseguito — nessuno spec esercita `/menu` (verifica empirica FASE 0).

## Context

Pre-S19: macro-task F1-shell (ADR-0018) ha lasciato `(authenticated)/menu/` come placeholder. Il backend F1 Menu (ADR-0019, sessione 17) espone 5 endpoint group REST (`/menus`, `/menus/:menuId/categories`, `/articles`, `/articles/:articleId/prices`, `/price-lists`) — pronti, non toccati da S19.

S19 è la **prima UI feature business** del progetto: tutte le decisioni di pattern (routing detail, data-fetching, form CRUD) diventano riferimento per le feature F1 successive (Mappa, Comande, Cassa, KDS, Report).

La verifica empirica **FASE 0** (READ-ONLY, bloccante) ha confermato 5 assunzioni di scoping:

| #   | Assunzione                                                 | Esito FASE 0                                                                                           |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A1  | `Article` 1:N `MenuCategory` (un articolo → una categoria) | ✅ confermata — `Article.categoryId` + relation `onDelete: Restrict` (schema.prisma:423/446)           |
| A2  | Update via verbo `PATCH`                                   | ✅ confermata — `@Patch(':id')` su tutti i controller → `apiPatch`                                     |
| A3  | `Article` ha un campo immagine                             | ✅ confermata — `Article.photoUrl String?` → branch "input URL" (vedi DP-6)                            |
| A4  | Parent soft-deleted → figli esclusi da GET list            | ✅ non devia — `softDeleteExtension` filtra per `deletedAt` del modello; detail di menu cancellato 404 |
| A5  | Pattern client di permission-check                         | ✅ `useAuth()` espone `permissions: string[]` → gating bottoni (DP-5)                                  |

## Decisions

### DP-1 — Routing: 2-livelli, primo segment dinamico

- `(authenticated)/menu/page.tsx` — list Menu (sostituisce il placeholder).
- `(authenticated)/menu/[menuId]/page.tsx` — detail (**primo `[id]` del progetto**).

**No deep-nesting `[catId]`/`[articleId]`:** categorie e articoli sono gestiti **inline nel detail** (componente `CategorySection`). Razionale: un menu F1 ha pochi livelli (menu → categorie → articoli) e la gestione inline evita 2 route-hop addizionali + 2 fetch-on-navigate per operazioni che l'utente compie in sequenza ravvicinata. Convenzione confermata: directory-per-route + `page.tsx` thin client component (pattern `dashboard`/`login`).

### DP-2 — No data-layer: client fetch + refetch on mutation

Confine S19 esplicito: **NO `@tanstack/react-query` / SWR / Server Actions** (refactor data-layer dedicato, futuro, con ADR proprio). `lib/menu-api.ts` espone funzioni tipizzate sopra `lib/api.ts`; ogni page/componente client chiama dentro `useEffect`/handler, tiene stato React locale, e dopo ogni mutation invoca un `load()`/`onReload()` che ri-fetcha. Il detail passa `load` come `onReload` a ogni `CategorySection` — single source of refetch.

Trade-off accettato: refetch "a grana grossa" (il detail ricarica menu + categorie + articoli dopo ogni mutation). Accettabile per la cardinalità F1 (pochi elementi); l'ottimizzazione è esattamente ciò che un data-layer introdurrà.

### DP-3 — Modello prezzo: solo `Article.basePrice` (§prezzo)

**Decisione:** la UI S19 gestisce **esclusivamente `Article.basePrice`** (campo intrinseco dell'articolo, obbligatorio in `CreateArticleDto`). **NON** crea/aggiorna `ArticlePrice` né consuma `/articles/:articleId/prices`.

Questa è una **deviazione consapevole dalla lettera della spec S19** (FASE 3/5 citavano "prezzo singolo PriceList Base via `article-prices`"). La scelta è stata esplicitamente delegata dall'owner in STOP 1. Razionale empirico:

1. **`basePrice` è già il prezzo dell'articolo** — campo `Decimal(10,2)` obbligatorio sullo schema (ADR-0019), sufficiente a "un articolo ha un prezzo".
2. **Atomicità.** Usare `article-prices` per il listino "Base" richiederebbe, sul create, 2 chiamate non-atomiche (`POST /articles` poi `POST /articles/:id/prices`): un fallimento della seconda lascia un articolo con `basePrice` ma senza `ArticlePrice` Base. Con solo `basePrice` il create è una singola POST → articolo sempre completo e valido.
3. **`ArticlePrice` è il meccanismo dei listini.** Il confine S19 differisce esplicitamente "Listini multipli UI / CRUD `price-lists`" a S20. `ArticlePrice` (join `Article` ↔ `PriceList`) è quel meccanismo — anche il listino "Base" è _un_ listino. La UI degli `ArticlePrice` nasce coerentemente in S20 insieme all'editor multi-listino, includendo Base.
4. **Niente lookup fragile.** Il listino "Base" è seedato per-tenant con `name: 'Base'` (seed.ts) — usarlo richiederebbe `GET /price-lists` + match magic-string sul nome. Eliminato.

**Conseguenza:** un articolo creato da S19 ha `basePrice` e zero righe `ArticlePrice` — stato DB valido (`ArticlePrice` è opzionale). S20 introdurrà la gestione `ArticlePrice` per tutti i listini.

### DP-4 — `lib/api.ts`: refactor 4-verbi con `request()` privato

Aggiunti `apiPatch` + `apiDelete`. Per evitare la quadruplicazione del blocco fetch+error, `apiGet`/`apiPost`/`apiPatch`/`apiDelete` delegano tutti a un `request()` privato (un solo punto per `buildHeaders` + `parseError` + handling 204). **Le firme pubbliche di `apiGet`/`apiPost` restano invariate** → i caller esistenti (`login`, `AuthContext`, `auth-logout`) non sono toccati. Verbo update = `PATCH` (A2). `DELETE` backend risponde `200 { data }` (non 204) — `request()` gestisce entrambi.

### DP-5 — Permission gating bottoni (branch A5)

`useAuth().permissions` (già esposto, ADR-0018) → la UI calcola booleani e nasconde i bottoni di mutation senza permesso:

| Permission                | Gate UI                                                |
| ------------------------- | ------------------------------------------------------ |
| `menu.categoria.gestisci` | create/edit/delete Menu + create/edit/delete Categoria |
| `menu.piatto.crea`        | create Articolo                                        |
| `menu.piatto.modifica`    | edit/delete Articolo                                   |

Gating **UX-only**: l'autorizzazione reale resta server-side (`@RequirePermissions` + `PermissionsGuard`, ADR-0017). Nascondere i bottoni evita all'utente azioni che fallirebbero 403, non sostituisce il controllo backend.

### DP-6 — Foto articolo: solo input URL (branch A3)

`Article.photoUrl` esiste (A3). S19 lo gestisce come **input URL testuale** nel form articolo. **Nessun display** dell'immagine e nessuna pipeline di upload — coerente con il confine S19 e con TD-BO (pipeline foto WebP). `next/image` per URL esterni arbitrari richiederebbe `remotePatterns` config; un `<img>` nativo genera errore lint (`@next/next/no-img-element` su `next lint`, e la direttiva `eslint-disable` di quella regola è a sua volta un errore su root `eslint .` che non carica il plugin Next). Display foto → TD-BO.

## Conventions

### Form numerici: campo stringa + validazione regex (no `z.coerce`)

`z.coerce.number()` rende il tipo input dello schema ≠ output, rompendo l'inferenza `zodResolver` + `useForm<z.infer<...>>` (errore `TS2322` su `Control`/`Resolver`). Convenzione adottata: **i campi numerici dei form restano stringa**, validati con regex (`/^\d+$/` per gli interi, `/^\d+([.,]\d{1,2})?$/` per gli importi) e convertiti con `Number()` al submit. Schema interamente `z.string()`/`z.enum()`/`z.boolean()` → input === output → resolver pulito (stesso pattern di `login/page.tsx`).

### Select enum: `<select>` nativo (no nuova dipendenza)

Confine "nessuna nuova dipendenza": `@radix-ui/react-select` non è installato. I campi enum (`vatPercent`, `printDepartment`, `availability`) usano `<select>` nativo dentro `FormControl`, con classi Tailwind allineate a `input.tsx`.

### Errori: `messageForError(err)` in `lib/error-codes.ts`

Estratto il pattern del `login/page.tsx` (`ApiError` → `messageForErrorCode`, altro → messaggio connessione) in `messageForError(err: unknown)`. Tutte le mutation menu lo usano. I conflict code backend (`E_MENU_NAME_EXISTS`, `E_MENU_CATEGORY_NAME_EXISTS`, `E_ARTICLE_NAME_EXISTS`) erano già mappati IT in `error-codes.ts` (ADR-0019) → zero estensioni mapping necessarie.

### i18n: namespace `menu` (it + en)

L'area `(authenticated)` usa uniformemente next-intl (dashboard, 7 placeholder). S19 aggiunge il namespace `menu` a `it.json` + `en.json` per non regredire il pattern. I messaggi di validazione zod restano IT inline (coerente con `login/page.tsx`).

## Tech debt

### TD-BT — Campi enum-array articolo non gestiti dal form S19

`Article.allergens` / `dietaryTags` / `channelVisibility` (array di enum, opzionali backend, default `[]`) **non sono nel form articolo S19**: richiedono un widget multi-select che esula dallo scope "CRUD base". Gli articoli creati da S19 hanno questi campi `[]`. Gli allergeni in particolare sono rilevanti (Reg. UE 1169/2011) e andranno gestiti prima dell'esposizione menu al cliente finale. Migration path: componente multi-select chip + estensione `CreateArticleInput`/`ArticleForm`. Stima: ~2h (widget + 3 campi + i18n label enum).

### TD-BU — Sidebar active-state non evidenzia le sub-route detail

`Sidebar.tsx` calcola `isActive` con match esatto `pathname === href`. Con l'introduzione del primo segment dinamico (`menu/[menuId]`), la voce nav "Menu" non risulta attiva quando si è su `/t/<slug>/menu/<id>`. Limitazione pre-esistente **esposta** da S19 (prima sub-route del progetto). Fix: match per prefisso (`pathname === href || pathname.startsWith(href + '/')`). Stima: ~10min + verifica che non crei falsi-positivi tra voci nav con prefisso comune.

## Files

### Nuovi file

| Path                                                               | Ruolo                                            |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| `apps/web/src/lib/menu-types.ts`                                   | Domain types F1 Menu + input types + enum const  |
| `apps/web/src/lib/menu-api.ts`                                     | Data access client (12 funzioni su `lib/api.ts`) |
| `apps/web/src/components/ui/dialog.tsx`                            | Modal dialog centrato (shadcn pattern)           |
| `apps/web/src/components/ui/textarea.tsx`                          | Multi-line input (shadcn pattern)                |
| `apps/web/src/components/menu/ConfirmDialog.tsx`                   | Dialog conferma soft-delete                      |
| `apps/web/src/components/menu/MenuForm.tsx`                        | Form create/edit Menu (RHF + zod)                |
| `apps/web/src/components/menu/CategoryForm.tsx`                    | Form create/edit Categoria                       |
| `apps/web/src/components/menu/ArticleForm.tsx`                     | Form create/edit Articolo                        |
| `apps/web/src/components/menu/CategorySection.tsx`                 | Categoria + articoli inline (CRUD)               |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/[menuId]/page.tsx` | Detail Menu (FASE 5)                             |
| `docs/architecture/ADR-0020-f1-menu-ui-crud.md`                    | questo file                                      |

### File modificati

| Path                                                      | Cosa cambia                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/web/src/lib/api.ts`                                 | +`apiPatch`/`apiDelete`, refactor `request()` privato (firme invariate) |
| `apps/web/src/lib/error-codes.ts`                         | +`messageForError(err)` helper                                          |
| `apps/web/src/app/t/[slug]/(authenticated)/menu/page.tsx` | placeholder → list Menu (FASE 4)                                        |
| `apps/web/src/i18n/messages/it.json` / `en.json`          | +namespace `menu`                                                       |

## Definition of Done F1 Menu UI (S19)

- [x] FASE 0 verifica empirica A1–A5 (READ-ONLY) + BASELINE registrata
- [x] FASE 1 — `lib/api.ts` esteso (`apiPatch`/`apiDelete`)
- [x] FASE 2 — routing list + detail (`menu/[menuId]`)
- [x] FASE 3 — data access client `menu-api.ts` (no react-query/SWR/Server Actions)
- [x] FASE 4 — `/menu` list: lista + create + soft-delete con conferma
- [x] FASE 5 — `/menu/[menuId]` detail: edit Menu + CRUD Categorie + CRUD Articoli (solo `basePrice`)
- [x] GATE — unit 91/91 invariato, typecheck clean, lint clean (root + next), `next build` OK
- [x] ADR-0020 + PROGRESS.md aggiornati; TD-BT + TD-BU catturati
- [ ] Screenshot manuale Nicolò (light/dark, list + detail, CRUD): da verificare post-implementazione
- [ ] HEAD main avanzato via squash merge PR (owner da UI)

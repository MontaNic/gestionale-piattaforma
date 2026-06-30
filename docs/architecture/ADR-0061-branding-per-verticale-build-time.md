# ADR-0061 — Branding per-verticale build-time: pattern riusabile

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Macro-task:** Task #4 dei task aperti 2026-06-30 (ultimo anello: i due verticali dicevano entrambi "Gestionale", zero logo)
- **Predecessor:** [ADR-0049](./ADR-0049-landing-pubblica-tenant.md) (identità pubblica per-tenant — dimensione T, fuori scope qui), [ADR-0060](./ADR-0060-sync-permessi-template-tenant-noop.md) (3 TD del verticale-dato)
- **Branch:** `feat/branding-per-verticale`

## Context

I due verticali (restaurant, accountant) condividevano lo stesso brand generico: `metadata.title: 'Gestionale'` in entrambe le app, login `CardTitle` hardcoded "Accedi a Gestionale", shell con `<span>Gestionale</span>`, **nessun logo/favicon**. Lo STOP 0 ha separato tre dimensioni da non collassare:

- **(V) Verticale** — restaurant vs accountant. Strutturale/build-time (due app + routing Caddy host-based; nessun dato `vertical`).
- **(T) Tenant** — il singolo studio/ristorante. Runtime, per-tenant: identità pubblica già presente (ADR-0049, `logoUrl/sitoWeb/…` + endpoint pre-auth `GET /public/tenants/:slug`).
- **(Θ) Tema** — dark mode class-based, già funzionante, ortogonale.

Serve dare a ogni verticale un brand reale (nome prodotto + logo/favicon) **senza** confondere V con T (il logo del singolo studio NON è il brand del verticale) né con Θ.

## Decision

**Branding per-verticale build-time, con un descrittore condiviso + istanza per-app.** Il verticale resta **strutturale per scelta** (vedi sotto): nessun dato `vertical`, nessuna migration.

### Pattern

- **Tipo `BrandConfig`** in `packages/ui` ([brand.ts](../../packages/ui/src/brand.ts)) — design-system già React-aware e consumato da entrambe le app via `transpilePackages`; evitato un package nuovo (YAGNI sul tooling). Export **type-only**, runtime-zero. Campi: `productName` (proper noun, non tradotto), `Logo` (componente SVG), `favicon` (path), `tagline?`. **Nessun campo colore** — la palette resta nei `globals.css` per-app (dimensione V già divergente, non toccata).
- **Istanza per-app** locale e disaccoppiata: [`apps/accountant-web/src/lib/brand.tsx`](../../apps/accountant-web/src/lib/brand.tsx) (`StudioDesk`), [`apps/restaurant-web/src/lib/brand.tsx`](../../apps/restaurant-web/src/lib/brand.tsx) (`FoodDesk`, segnaposto). **Nessuna app importa il brand di un'altra** — è ciò che rende il pattern riusabile: niente registry centrale che accoppia i verticali.
- **Asset placeholder generati via codice**: wordmark SVG in `currentColor` (rende in light **e** dark) + favicon-tile a colore fisso (giusto: il favicon nel tab non segue il dark mode). Sostituibili droppando un file conforme nello stesso path, senza altri cambi.
- **Cablaggio** (per-app, simmetrico): `metadata.title`/`applicationName`/`icons` ← brand; login title → `<brand.Logo aria-label={t('auth.login.title', { brand })}/>` (titolo **i18n** "Accedi a {brand}", brand come **parametro** → non entra nel catalogo tradotto); shell Sidebar header + Topbar mobile → `brand.Logo`.

### Perché il verticale resta strutturale (non è una mancanza, è il taglio)

Introdurre un dato `vertical` (su `tenants`/`system_role_templates`) è **fuori scope per scelta**, non per dimenticanza. Oggi il verticale = "quale app" (routing host-based, due build separate) è sufficiente per il branding: ogni app conosce il proprio verticale staticamente. Il **verticale-dato** nascerà quando avrà un consumer reale — il trigger dei 3 TD di [ADR-0060](./ADR-0060-sync-permessi-template-tenant-noop.md) (`TD-perm-propagation`, `TD-bootstrap-verticale`, `TD-role-template-key`): nascita del primo tenant via API bootstrap. Anticiparlo qui sarebbe astrazione prematura (vietata da BRIEF §F1) e pagherebbe un debito che non ha ancora trigger.

### Il valore duraturo: il pattern paga il prossimo verticale

Aggiungere un verticale futuro = fornire **una sola istanza `brand`** conforme a `BrandConfig`. Login, `metadata`, shell (Sidebar/Topbar) e slot-asset (`/icon.svg`) ereditano il brand **gratis**, senza clonare il login né duplicare il cablaggio. Il costo marginale del terzo verticale è un brand object + due asset, non una nuova superficie UI.

## Consequences

- **Positive:** i due verticali hanno finalmente brand distinti (StudioDesk / FoodDesk) su login + shell + tab; il pattern è riusabile e disaccoppiato; nessun accoppiamento V/T/Θ (palette intatta, identità tenant ADR-0049 non cablata sul login, dark invariato). Effetto collaterale corretto: il login restaurant, prima hardcoded senza namespace `auth`, è ora i18n al pari di accountant.
- **Negative / debito residuo:** `FoodDesk` è un segnaposto (sostituibile in una riga). Il brand resta build-time: un branding per-tenant (T) o per-verticale-da-dato è lavoro futuro legato al verticale-dato. La `CardDescription` del login resta hardcoded IT (famiglia TD-i18n preesistente, fuori dal perimetro brand — non allargato per non fare scope creep).
- **GATE ADR-0052:** completo (FE live). CHECK-FE-1 dark ✅ (wordmark non sparisce, render reale light+dark) · FE-2 i18n IT↔EN ✅ (`auth.login.title`, brand come param) · FE-3 no IT hardcoded reintrodotto ✅ · FE-4 `next build` ✅ entrambe · FE-5 responsive ✅ · FE-6 a11y ✅ (`role="img"` + accessible name = titolo i18n).

## Links

- [ADR-0049](./ADR-0049-landing-pubblica-tenant.md) (identità pubblica per-tenant, dimensione T), [ADR-0060](./ADR-0060-sync-permessi-template-tenant-noop.md) (3 TD del verticale-dato), [ADR-0027](./ADR-0027-composizione-core-condiviso.md) (estrazione core / `packages/ui`).

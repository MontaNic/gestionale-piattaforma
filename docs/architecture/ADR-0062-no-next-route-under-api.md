# ADR-0062 — Contratto: nessuna route Next sotto `/api/*` (riservato al backend same-origin)

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Contesto scatenante:** bug cambio lingua in prod (route Next `POST /api/set-locale` ingoiata da Caddy)
- **Predecessor:** [ADR-0042](./ADR-0042-domains-resolver-colocated-hosts.md) (routing Caddy path-based same-origin: `/api/*` → backend, resto → web), [ADR-0018](./ADR-0018-f1-shell-ui-foundation.md) (meccanismo locale switch)
- **Branch:** `fix/i18n-set-locale-route`

## Context

Il deploy usa routing **same-origin path-based** (ADR-0042 §1, `infra/caddy/conf/Caddyfile`): Caddy fa `handle /api/*` → backend NestJS (`accountant-api` / `restaurant-api`, global prefix `/api/v1`), **tutto il resto** → web Next (`accountant-web` / `restaurant-web`). Stesso pattern su entrambi i verticali.

Una **route handler Next** montata sotto `app/api/**/route.ts` risponde in dev (Next serve la propria route) ma in **prod è irraggiungibile**: Caddy la instrada al backend, che non ha quella route → **404**. È esattamente il bug del cambio lingua: `POST /api/set-locale` (route Next) → 404 dal backend → cookie mai scritto → UI resta in italiano, **per tutti gli utenti**, su **entrambi** i verticali. Invisibile in dev (nessun Caddy), quindi sfuggito a build e e2e locali.

## Decision

**Nessuna route handler Next può vivere sotto `app/api/**`.** Il prefisso `/api/\*`è **riservato al backend NestJS same-origin**. Le route di meccanismo lato web (es. il setter del cookie locale) vivono a un **path top-level fuori da`/api/`** (es. `/set-locale`), così Caddy le instrada al web.

Il contratto è reso **eseguibile**, non solo documentato: un guard in CI fallisce se compare una route sotto `apps/*/src/app/api/**/route.ts`, con un messaggio che spiega il **perché** (Caddy ingoia `/api/*` → usa un path top-level) — così chi ci sbatte in futuro capisce la ragione senza ricostruire questo bug.

### Applicazione (questo fix)

- `app/api/set-locale/route.ts` → `app/set-locale/route.ts` in **entrambi** i verticali; client `@gestionale/i18n` aggiornato a `fetch('/set-locale')`.
- Middleware: `/set-locale` aggiunto alle esclusioni del matcher con anchor di **segmento** (`set-locale$`, non prefisso) — trasforma un pass-through emergente in contratto esplicito (l'endpoint è dichiarato non-pagina, allineato ad `api/`).
- Guard CI (`scripts/check-no-api-next-routes.sh`) nel job checks.

## Consequences

- **Positive:** la classe di bug (route web nel namespace backend) è chiusa alla radice ed eseguibile in CI; il cambio lingua funziona in prod su entrambi i verticali; il contratto same-origin di ADR-0042 è ora auto-enforced.
- **Negative / limiti:** il guard è una euristica di path (grep) — non intercetta altri modi di collidere col proxy (improbabili). Il mini-e2e switcher (restaurant) copre la logica, non la classe prod-routing (dev non ha Caddy) — quella resta chiusa dal guard + verifica prod reale.
- **Note:** se in futuro servisse davvero una BFF-route Next, andrà su un prefisso dedicato non-`/api` (es. `/bff/*`) e/o Caddy andrà esteso esplicitamente — decisione a parte, non ammessa in silenzio sotto `/api`.

## Links

- [ADR-0042](./ADR-0042-domains-resolver-colocated-hosts.md), [ADR-0018](./ADR-0018-f1-shell-ui-foundation.md).
- `infra/caddy/conf/Caddyfile` (blocchi apex/wildcard + `food.studiodesk.cloud`).

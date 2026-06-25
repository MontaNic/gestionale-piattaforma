# ADR-0049 — Landing pubblica per-tenant: identità studio + endpoint pubblico

Status: Accepted
Date: 2026-06-25
Verticale: accountant (livello 0, superficie pubblica pre-login)

## Context

Le superfici accountant finora sono tutte **post-auth**: studio (operatore) e
portale (cliente) richiedono un JWT. Manca una **superficie pubblica** alla
radice dello slug (`/t/<slug>`): una pagina vetrina dello studio, raggiungibile
senza login, con l'unica call-to-action verso `/t/<slug>/login`.

Due vincoli emersi dalla ricognizione (STOP 0):

1. Il modello `Tenant` ha solo `name`/`slug`/`isActive`/timestamps — **nessun
   campo identità/branding** (descrizione, contatti, logo).
2. Non esiste alcun endpoint `@Public()` che legga un tenant per slug: il
   default è auth-required (JwtAuthGuard globale, opt-out `@Public()`, ADR-0008).
   Una pagina pre-login non può recuperare nulla senza un nuovo endpoint.

## Decision

### 1. DP-schema — 6 campi identità nullable su `Tenant`

`descrizione`, `indirizzo`, `telefono`, `emailContatto` (`@map email_contatto`),
`sitoWeb` (`@map sito_web`), `logoUrl` (`@map logo_url`). Tutti `String?`:

- assenza = sezione omessa nella UI (nessun default fittizio);
- migration puramente additiva (`ALTER TABLE ADD COLUMN`, nullable) → zero
  backfill, safe su dati esistenti.

Nessun campo è segreto: per design sono pubblicabili senza auth.

### 2. DP-endpoint — `GET /public/tenants/:slug` (`@Public`)

Nuovo `PublicModule` in accountant-api (fuori da platform/portale). `@Public()`
opt-out del JwtAuthGuard globale; `TenantConsistencyGuard` salta su `@Public`; il
throttler `default` resta attivo → rate-limit anti-abuso sulla superficie non
autenticata. Tenant resolution via **URL param** (no header `X-Tenant-Slug` →
niente `TenantMiddleware`).

**Sicurezza del bypass RLS.** Richiesta non autenticata = nessun `req.tenantId` =
nessun RLS context. Come `PlatformService`, la lettura cross-tenant gira in
`withSystemContext` (is_super_admin → bypass RLS). Essendo un bypass su endpoint
pubblico, l'esposizione è contenuta a livello di query, non di guard:

- `select` esplicito dei **soli** campi safe (`slug`, `name` + i 6 identità) —
  mai `id` interno, `isActive`, `deletedAt`;
- filtro `isActive: true, deletedAt: null` → **404** su tenant sospeso/cancellato
  (no information leak sull'esistenza di tenant inattivi).

### 3. DP-creazione — `CreateTenantDto` esteso (campi opzionali)

I 6 campi entrano in `CreateTenantDto` come `@IsOptional()`; `sitoWeb`/`logoUrl`
validati `@IsUrl({ require_protocol: true })` (URL esterne, **zero storage**:
nessun upload, il logo è un URL remoto). `TenantsService.createTenant` li
persiste (`undefined → null`). `CreateTenantResult` invariato (non li espone).

### 4. DP-FE — single-page client, nessuna shell

`apps/accountant-web/src/app/t/[slug]/page.tsx`: client component (fetch
browser-side perché `NEXT_PUBLIC_API_URL` è relativo, browser-only). Vive nel
layout slug (i18n + AuthProvider) ma **non** richiede login e **non** usa la shell
studio né `PortaleShell`. Stile essenziale (hero: logo + nome + descrizione,
contatti condizionali, CTA "Accedi"). Logo via `<img>` (URL esterna, niente
`remotePatterns` in next.config → niente file di config aggiuntivi).

## Consequences

- La superficie pubblica è ora **3 livelli**: pubblico (`/t/<slug>`) → studio →
  portale. Il middleware FE non cambia (lo slug valido passa già).
- Il superadmin può popolare l'identità via `CreateTenantDto`; il seed
  (`studio-demo` = "Studio Ferretti & Lombardi") fornisce il dato demo.
- `logoUrl` come URL esterna è un compromesso (no storage): un eventuale upload
  asset è lavoro futuro, fuori scope.
- Endpoint pubblico = nuova superficie di attacco: mitigata da select-allowlist,
  filtro attivo e throttler. Da tenere d'occhio se si aggiungono campi al tenant
  (regola: ogni nuovo campo è pubblico per default solo se aggiunto al `select`).

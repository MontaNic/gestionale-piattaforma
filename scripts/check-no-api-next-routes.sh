#!/usr/bin/env bash
# =============================================================================
# check-no-api-next-routes.sh — guard del contratto ADR-0062
# =============================================================================
# Fallisce se esiste una route handler Next sotto `apps/*/src/app/api/**`.
# Il prefisso `/api/*` è riservato al backend NestJS same-origin: Caddy fa
# `handle /api/*` -> api (ADR-0042 §1). Una route Next lì risponde in dev ma in
# PROD viene ingoiata dal proxy -> 404 (fu il bug del cambio lingua). Le route
# di meccanismo web vanno a un path top-level fuori da `/api/` (es. /set-locale).
# =============================================================================
set -euo pipefail

# Route handler Next sotto app/api (App Router: route.ts | route.tsx | route.js)
matches="$(find apps/*/src/app/api -type f \( -name 'route.ts' -o -name 'route.tsx' -o -name 'route.js' \) 2>/dev/null || true)"

if [ -n "$matches" ]; then
  echo "❌ Contratto ADR-0062 violato — route Next sotto /api/:" >&2
  echo "$matches" | sed 's/^/   - /' >&2
  cat >&2 <<'MSG'

PERCHÉ è vietato: in prod Caddy instrada `handle /api/*` verso il backend NestJS
(ADR-0042 §1, infra/caddy/conf/Caddyfile). Una route handler Next sotto /api/
risponde in dev ma in prod viene ingoiata dal proxy → 404 (è stato il bug del
cambio lingua: POST /api/set-locale → 404 → cookie mai scritto → UI resta in IT).

COME correggere: sposta la route a un path TOP-LEVEL fuori da /api/, es.
`app/set-locale/route.ts` (path /set-locale), e aggiornane il fetch client.
Se serve davvero una BFF-route, usa un prefisso dedicato non-/api (es. /bff/*)
ed estendi Caddy esplicitamente — mai in silenzio sotto /api.
MSG
  exit 1
fi

echo "✅ ADR-0062 ok: nessuna route Next sotto /api/ (namespace riservato al backend)."

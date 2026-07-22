#!/bin/bash
# =============================================================================
# verify-guard-runtime.sh — prova RUNTIME del guard anti-prod-da-host (Sub-A)
# =============================================================================
# I 9 test di Sub-A sono UNIT sulla funzione pura `assertSafeDbTarget` (src).
# Questo script verifica il livello che a Sub-A non era osservabile senza un DB
# dev isolato: che il guard sia EFFETTIVO nell'artefatto BUILDATO (`dist`) e
# giri a load-time importando `@gestionale/db` (via `createPrismaClient()`).
#
# Discovery Sub-B: il `dist` sull'host era stale (pre-Sub-A) -> il guard era
# INERTE per i dev server (che importano il dist, non il src). Il check 0 sotto
# cattura esattamente quella regressione. Rieseguire dopo ogni modifica al guard
# o al build di packages/db.
#
# Scenari (3 processi separati: il singleton `prisma` si crea una volta per
# processo, quindi ogni env richiede un node fresco):
#   1. prod-shaped + NODE_ENV unset          -> DEVE abortire (ProdDbAccessBlockedError)
#   2. dev target (55432)                     -> NON deve abortire
#   3. prod-shaped + ALLOW_PROD_DB_ACCESS=1   -> NON deve abortire (whitelist)
#
# NB: password fittizia negli url prod-shaped: il guard aborta PRIMA del connect,
# ma la pw bogus e' una seconda rete di sicurezza (auth fallirebbe comunque).
# =============================================================================
set -euo pipefail

DIST="$(cd "$(dirname "$0")/.." && pwd)/dist/index.cjs"
PROD_URL='postgresql://guard_probe:bogus_no_connect@127.0.0.1:5432/gestionale?schema=public'
DEV_URL='postgresql://gestionale_app:devapplocal@127.0.0.1:55432/gestionale?schema=public'

# Check 0: il guard DEVE essere nel dist (cattura "dist stale" = guard inerte).
if ! grep -q 'assertSafeDbTarget' "$DIST" 2>/dev/null; then
  echo "FAIL[0]: guard assente nel dist ($DIST) — build stale. Esegui: pnpm --filter @gestionale/db build" >&2
  exit 1
fi
echo "OK[0]: guard presente nel dist"

# probe <label> <expect: throw|ok> — importa il dist reale, l'env e' gia' settato.
probe() {
  DIST="$DIST" LBL="$1" EXPECT="$2" node -e '
    try {
      require(process.env.DIST);
      if (process.env.EXPECT === "throw") { console.error("FAIL: nessun throw ("+process.env.LBL+")"); process.exit(1); }
      console.log("OK: "+process.env.LBL+" -> import pulito");
    } catch (e) {
      if (e.name !== "ProdDbAccessBlockedError") throw e;
      if (process.env.EXPECT !== "throw") { console.error("FAIL: abort inatteso ("+process.env.LBL+")"); process.exit(1); }
      console.log("OK: "+process.env.LBL+" -> abort ("+e.name+")");
    }
  '
}

echo "--- scenari ---"
DATABASE_URL="$PROD_URL"                         probe "prod-shaped + NODE_ENV unset" throw
DATABASE_URL="$DEV_URL"                          probe "dev target (55432)"           ok
ALLOW_PROD_DB_ACCESS=1 DATABASE_URL="$PROD_URL"  probe "prod-shaped + whitelist"      ok

echo "verify-guard-runtime.sh: PASS (guard effettivo nel dist)"

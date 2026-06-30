# @gestionale/db

Schema Prisma, client multi-tenant e tooling DB condiviso tra i verticali.

Il client applicativo si crea con `createPrismaClient()` (factory che applica
l'estensione soft-delete + l'estensione RLS sul ruolo `gestionale_app`). Le API
RLS (`runInTenantContext`, `withSystemContext`, `withSuperAdminContext`) sono
ri-esportate da `src/index.ts`. Vedi il README di root per il runbook RLS.

Tutti gli script `pnpm` di questo package caricano `../../.env` via `dotenv-cli`.

## Ops — `purge-tenant`

Hard-delete **guardato** di un tenant di test/verifica dal DB prod condiviso.
I tenant di test ricorrono (fixture, verifiche di deploy, smoke): questo comando
li rimuove in modo ripetibile invece di SQL ad-hoc, con guard-rail pensati per
evitare di toccare i tenant operativi.

```bash
# dry-run (DEFAULT — nessuna modifica): stampa target + blast radius
pnpm --filter @gestionale/db purge-tenant --slug verifica-41554

# esecuzione reale (transazionale, con verifica pre-commit)
pnpm --filter @gestionale/db purge-tenant --slug verifica-41554 --execute

# più target insieme (slug e/o id, ripetibili)
pnpm --filter @gestionale/db purge-tenant --id <uuid> --slug <altro> --execute
```

**Guard-rail (non negoziabili):**

1. **Blocklist well-known** — `demo`, `acme`, `studio-demo`, `oneplatform` non
   sono cancellabili: se uno compare nel set target → abort, nessun `DELETE`.
2. **Match esatto** per `--slug`/`--id` passati esplicitamente, mai pattern
   `LIKE`: cancella ciò che indichi, non un'euristica che in futuro cattura altro.
3. **Dry-run di default** — senza `--execute` stampa solo il blast radius ed esce.
4. **Transazione con verifica pre-commit** — `COMMIT` solo se il numero di tenant
   cancellati combacia coi target **e** i figli risultano azzerati; altrimenti
   `ROLLBACK`.

**Connessione:** usa `DIRECT_URL` (ruolo `postgres` superuser, `BYPASSRLS`) —
l'unico che può cancellare cross-tenant senza essere filtrato dalla RLS `FORCE`.
Il `CASCADE` delle FK verso `tenants` pulisce i figli col singolo `DELETE`.

Exit code: `0` ok (dry-run o delete riuscito), `1` guard/validazione fallita o
mismatch pre-commit (rollback), `2` errore inatteso.

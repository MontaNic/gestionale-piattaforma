# ADR-0072 — Dev DB isolato dev-by-default + convenzioni init role (Sub-B)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Nicolò (owner), Claude (AI partner)
- **Related:** [ADR-0009](./ADR-0009-rls-real.md) (RLS reali, role `gestionale_app`), `TD-dev-env-punta-prod` Sub-A (guard `assert-safe-db-target`), Sub-B (questo ADR)

## Context

Sull'host la produzione gira su un unico Postgres `127.0.0.1:5432/gestionale`. Il near-incident (dev server dell'host che eredita il `.env` root e punta a prod) è stato mitigato da Sub-A con un **guard meccanizzato** in `createPrismaClient()` (`assertSafeDbTarget`). Sub-A chiudeva il **vettore** ma non forniva un'**alternativa dev legittima**: senza un DB dev isolato, l'operatore resta tentato di puntare a prod, la verifica runtime del guard è impossibile senza rischio, e Sub-2 (full-stack blob/multipart) resta bloccato.

Sub-B fornisce quel DB dev isolato. Durante l'implementazione, la **verifica a runtime** — resa possibile proprio dall'ambiente dev — ha smentito due assunzioni consolidate lette staticamente in STOP 0/1.

## Decision

### 1. DB dev isolato, compose standalone, dev-by-default

Secondo container Postgres (`postgres-dev`) in un compose **standalone** ([`docker-compose.devdb.yml`](../../docker-compose.devdb.yml)), **mai** nel merge prod:

- **Project name esplicito** `gestionale-devdb`: senza, Compose userebbe la basename della dir (`gestionale`) = stesso progetto dei container prod → comparirebbero come "orphan" e un `down --remove-orphans` li spazzerebbe via.
- Isolamento per **processo + volume + istanza + rete** (`gestionale_postgres_dev` / `postgres_dev_data` / porta `127.0.0.1:55432` / `gestionale_devdb_network`). Credenziali dev **≠** prod, in chiaro nel compose (accettabile come le password seed).
- `55432 ≠ 5432` → il guard Sub-A non matcha → passa; resta difesa in profondità.
- **Env injection** senza toccare il `.env` root: gli script `dev` delle 2 API usano `dotenv -e ../../.env.devdb -e ../../.env`. **Precedenza dotenv-cli verificata empiricamente**: il **primo** `-e` vince; una var già in `process.env` e un `-v` vincono su qualunque `-e`. `.env.devdb` (committato, solo i 2 url dev) fornisce `DATABASE_URL`/`DIRECT_URL`; il resto cade sul `.env` root intatto. **Inversione: dev-by-default, prod richiede intenzione esplicita.**

### 2. Convenzione init role: interpolazione fuori dal dollar-quoting + idempotente + fail-loud

`docker-entrypoint-initdb.d/*.sh` che creano ruoli DB con una password iniettata devono:

- **Interpolare la password FUORI da qualunque blocco `DO $$…$$`**. psql **non** espande `:var` dentro il dollar-quoting → un `CREATE ROLE … PASSWORD :'pw'` dentro `DO $$` fallisce con `syntax error at or near ":"`. Pattern corretto: `SELECT format('CREATE ROLE … PASSWORD %L …', :'pw') WHERE NOT EXISTS (…) \gexec` (interpolazione in un SELECT semplice, `%L` quota in sicurezza, `\gexec` esegue).
- **Idempotente** (`WHERE NOT EXISTS` / guard equivalente): re-boot su volume esistente non deve rompere.
- **Fail-loud**: post-check che il role esista con gli attributi attesi, altrimenti `exit 1`. Un init rotto deve **impedire** al container di diventare healthy, non passare inosservato.

### 3. Build-currency del guard è parte del contratto

Il guard vive in `packages/db`; i consumer (dev server) importano il **`dist` buildato**, non il src. Un `dist` stale = guard **inerte**. Regola operativa: il guard è garantito solo con `packages/db` buildato aggiornato. Root `pnpm dev` fa il `^build` Turbo; un `pnpm --filter <api> dev` diretto no → build esplicito. Lo script `verify:guard-runtime` (check[0]) fallisce se il guard è assente dal `dist`.

## Consequences

**Positive:**

- `TD-dev-env-punta-prod` chiuso (Sub-A guard + Sub-B ambiente); Sub-2 sbloccato.
- Il fix init ripara il **bootstrap fresco** per entrambi i verticali: da bug latente di disaster-recovery a bootstrap affidabile. La convenzione init previene la classe di bug.
- Verifica runtime del guard ora riproducibile senza rischio prod.

**Costi / rischi:**

- Il fix init tocca `infra/postgres/init` **condivisa** con prod. Mitigazione: `initdb.d` gira solo a volume vuoto → prod running (volume esistente) non impattato; solo il bootstrap fresco cambia (in meglio).
- Un secondo Postgres dev consuma RAM/disk sull'host (accettato: isolamento > costo).

**Discovery a verbale (senior empirical re-validation):** STOP 0/1 avevano dato per corretti l'init (dai suoi commenti) e attivo il guard (dai suoi test unit sul src). Il runtime — abilitato da Sub-B — ha smentito entrambi. Lezione: una lettura consolidata non è verità eterna; il runtime che l'ambiente dev abilita è lo strumento di verifica che mancava.

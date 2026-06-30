# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Manifesti workspace (per pnpm install --frozen-lockfile)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/restaurant-api/package.json ./apps/restaurant-api/
COPY packages/auth/package.json        ./packages/auth/
COPY packages/db/package.json          ./packages/db/
COPY packages/platform/package.json    ./packages/platform/
COPY packages/shared/package.json      ./packages/shared/

# Install (solo prod + dev necessari per build)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Sorgenti
COPY tsconfig.base.json turbo.json ./
COPY apps/restaurant-api ./apps/restaurant-api
COPY packages/auth      ./packages/auth
COPY packages/db        ./packages/db
COPY packages/platform  ./packages/platform
COPY packages/shared    ./packages/shared

# Genera il client Prisma (engine musl per alpine; non serve DB attivo) poi
# builda in ordine topologico (turbo risolve db/shared -> platform -> auth -> api).
# NB: restaurant-api builda con `nest build --builder swc` (come accountant): swc
# transpila senza type-check (gate separato `pnpm typecheck`), evitando gli errori
# di risoluzione tipi tsc-in-emit su path-to-source. Output swc -> dist/src/main.js.
RUN pnpm --filter @gestionale/db exec prisma generate && \
    pnpm turbo run build --filter=@gestionale/restaurant-api...

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Preserva il layout pnpm del builder invece di re-installare (pnpm deploy 9.15
# ri-risolve il workspace e perderebbe il client Prisma generato). Si copiano:
# - node_modules root: lo store virtuale .pnpm (incl. @prisma/client + engine musl
#   gia generato) verso cui puntano tutti i symlink relativi
# - packages/*: dir reali dei workspace dep (target dei symlink @gestionale/*)
# - apps/restaurant-api/node_modules: la symlink-farm delle deps dell'app
# - dist + package.json dell'app
# L'app gira dalla sua dir cosi Node risolve via apps/restaurant-api/node_modules
# -> ../../node_modules/.pnpm (symlink relativi, validi nella stessa struttura).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/restaurant-api/node_modules ./apps/restaurant-api/node_modules
COPY --from=builder /app/apps/restaurant-api/dist ./apps/restaurant-api/dist
COPY --from=builder /app/apps/restaurant-api/package.json ./apps/restaurant-api/

WORKDIR /app/apps/restaurant-api
EXPOSE 3004
# swc emette preservando sourceRoot (src/) -> dist/src/main.js. Coerente con
# `start:prod` del package.json (entrambi node dist/src/main.js).
CMD ["node", "dist/src/main.js"]

# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Manifesti workspace. NB: restaurant-web dichiara @gestionale/db (dual package) —
# va incluso il manifest/sorgente db + `prisma generate` (sotto) perche turbo `...`
# include db nel grafo e ne esegue il build (tsup), che importa il client Prisma.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/restaurant-web/package.json  ./apps/restaurant-web/
COPY packages/auth-web/package.json    ./packages/auth-web/
COPY packages/ui/package.json          ./packages/ui/
COPY packages/i18n/package.json        ./packages/i18n/
COPY packages/api-client/package.json  ./packages/api-client/
COPY packages/shared/package.json      ./packages/shared/
COPY packages/db/package.json          ./packages/db/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Sorgenti (transpilePackages — compilati da Next direttamente; db buildato da turbo)
COPY tsconfig.base.json turbo.json ./
COPY apps/restaurant-web  ./apps/restaurant-web
COPY packages/auth-web    ./packages/auth-web
COPY packages/ui          ./packages/ui
COPY packages/i18n        ./packages/i18n
COPY packages/api-client  ./packages/api-client
COPY packages/shared      ./packages/shared
COPY packages/db          ./packages/db

ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* sono inlined da Next a BUILD-TIME (non runtime): l'api-client gira
# solo lato browser, quindi base URL relativo /api/v1 -> same-origin su
# food.studiodesk.cloud. Caddy instrada /api/* al restaurant-api.
ENV NEXT_PUBLIC_API_URL=/api/v1
# Genera il client Prisma (engine musl) per il build di @gestionale/db (tsup), poi
# turbo builda i workspace dep con script build (shared, db) in ordine, poi next build.
# ui/i18n/api-client/auth-web non hanno 'build' (transpilati da Next) -> turbo li salta.
RUN pnpm --filter @gestionale/db exec prisma generate && \
    pnpm turbo run build --filter=@gestionale/restaurant-web...

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/apps/restaurant-web/.next/standalone ./
COPY --from=builder /app/apps/restaurant-web/.next/static     ./apps/restaurant-web/.next/static
COPY --from=builder /app/apps/restaurant-web/public           ./apps/restaurant-web/public

EXPOSE 3005
CMD ["node", "apps/restaurant-web/server.js"]

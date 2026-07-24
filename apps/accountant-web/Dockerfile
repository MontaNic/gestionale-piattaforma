# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Manifesti workspace
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/accountant-web/package.json  ./apps/accountant-web/
COPY packages/auth-web/package.json    ./packages/auth-web/
COPY packages/ui/package.json          ./packages/ui/
COPY packages/i18n/package.json        ./packages/i18n/
COPY packages/api-client/package.json  ./packages/api-client/
COPY packages/shared/package.json      ./packages/shared/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Sorgenti (transpilePackages — compilati da Next direttamente)
COPY tsconfig.base.json turbo.json ./
COPY apps/accountant-web  ./apps/accountant-web
COPY packages/auth-web    ./packages/auth-web
COPY packages/ui          ./packages/ui
COPY packages/i18n        ./packages/i18n
COPY packages/api-client  ./packages/api-client
COPY packages/shared      ./packages/shared

ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* sono inlined da Next a BUILD-TIME (non runtime): l'api-client gira
# solo lato browser (tutti i consumer sono 'use client'), quindi base URL relativo
# /api/v1 -> same-origin su apex e su ogni tenant *.studiodesk.cloud (tenancy via
# header X-Tenant-Slug, host-agnostica). Caddy instrada /api/* all'accountant-api.
ENV NEXT_PUBLIC_API_URL=/api/v1
# turbo builda i workspace dep con script build (shared) in ordine, poi next build.
# ui/i18n/api-client/auth-web non hanno 'build' (transpilati da Next) -> turbo li salta.
RUN pnpm turbo run build --filter=@gestionale/accountant-web...

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Provenienza dell'immagine (OCI image-spec). Prima di questa label il SHA non era
# tracciato da nessuna parte: `docker inspect` mostrava solo le label
# com.docker.compose.*, e l'unico modo di risalire al commit era una convenzione di
# tagging manuale (es. portata-167cb3d) mai applicata alle immagini accountant.
# GIT_SHA arriva dal build arg: ${GIT_SHA:-unknown} in dev, ${GIT_SHA:?...} in prod
# (fail-closed: il build di produzione si rifiuta di partire senza SHA). Il default
# `unknown` copre i build diretti fuori dal compose di prod: docker-compose.dev.yml
# non builda le app (contiene solo postgres/redis/caddy/mailpit), quindi non c'e' un
# compose dev in cui mettere la variante permissiva. Vedi ADR-0079.
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
LABEL org.opencontainers.image.source=https://github.com/MontaNic/gestionale-piattaforma

COPY --from=builder /app/apps/accountant-web/.next/standalone ./
COPY --from=builder /app/apps/accountant-web/.next/static     ./apps/accountant-web/.next/static
COPY --from=builder /app/apps/accountant-web/public           ./apps/accountant-web/public

EXPOSE 3003
CMD ["node", "apps/accountant-web/server.js"]

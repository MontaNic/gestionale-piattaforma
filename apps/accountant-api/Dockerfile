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
COPY apps/accountant-api/package.json ./apps/accountant-api/
COPY packages/auth/package.json        ./packages/auth/
COPY packages/db/package.json          ./packages/db/
COPY packages/platform/package.json    ./packages/platform/
COPY packages/shared/package.json      ./packages/shared/

# Install (solo prod + dev necessari per build)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Sorgenti
COPY tsconfig.base.json turbo.json ./
COPY apps/accountant-api ./apps/accountant-api
COPY packages/auth      ./packages/auth
COPY packages/db        ./packages/db
COPY packages/platform  ./packages/platform
COPY packages/shared    ./packages/shared

# Genera il client Prisma (engine musl per alpine; non serve DB attivo) poi
# builda in ordine topologico (turbo risolve db/shared -> platform -> auth -> api)
RUN pnpm --filter @gestionale/db exec prisma generate && \
    pnpm turbo run build --filter=@gestionale/accountant-api...

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Solo i file necessari per l'avvio
COPY --from=builder /app/apps/accountant-api/dist ./dist
COPY --from=builder /app/apps/accountant-api/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/auth/dist      ./packages/auth/dist
COPY --from=builder /app/packages/auth/package.json ./packages/auth/
COPY --from=builder /app/packages/db/dist        ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/platform/dist  ./packages/platform/dist
COPY --from=builder /app/packages/platform/package.json ./packages/platform/
COPY --from=builder /app/packages/shared/dist    ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

EXPOSE 3002
CMD ["node", "dist/src/main.js"]

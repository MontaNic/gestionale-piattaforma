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

# Preserva il layout pnpm del builder invece di re-installare (pnpm deploy 9.15
# ri-risolve il workspace e perderebbe il client Prisma generato). Si copiano:
# - node_modules root: lo store virtuale .pnpm (incl. @prisma/client + engine musl
#   gia generato) verso cui puntano tutti i symlink relativi
# - packages/*: dir reali dei workspace dep (target dei symlink @gestionale/*)
# - apps/accountant-api/node_modules: la symlink-farm delle deps dell'app
# - dist + package.json dell'app
# L'app gira dalla sua dir cosi Node risolve via apps/accountant-api/node_modules
# -> ../../node_modules/.pnpm (symlink relativi, validi nella stessa struttura).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/accountant-api/node_modules ./apps/accountant-api/node_modules
COPY --from=builder /app/apps/accountant-api/dist ./apps/accountant-api/dist
COPY --from=builder /app/apps/accountant-api/package.json ./apps/accountant-api/

# Root dello storage locale (STORAGE_LOCAL_ROOT, valorizzata nel compose di prod).
# Deliberatamente FUORI da /app: il mount point non deve dipendere dal layout del
# monorepo dentro l'immagine. Serve che la dir esista gia' qui perche' il named
# volume ne eredita ownership e contenuto alla prima creazione.
#
# Nessun `chown`: i runner stage girano come root (nessuna direttiva USER in
# nessuna delle quattro app), quindi non c'e' un utente da accontentare e un
# `chown root:root` sarebbe un no-op che suggerisce al lettore un de-privilegio
# inesistente. Vedi TD-container-runs-as-root in ADR-0079.
RUN mkdir -p /var/lib/gestionale/storage

WORKDIR /app/apps/accountant-api
EXPOSE 3002
CMD ["node", "dist/src/main.js"]

# Build context: repo root (needs packages/shared + pnpm workspace)

# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm@9.15.9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web-portal/package.json ./apps/web-portal/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --no-frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9.15.9

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web-portal/node_modules ./apps/web-portal/node_modules/

COPY package.json pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/web-portal ./apps/web-portal

ARG NEXT_PUBLIC_LICENSE_SERVER_URL=http://localhost:3001
ENV NEXT_PUBLIC_LICENSE_SERVER_URL=${NEXT_PUBLIC_LICENSE_SERVER_URL}

# Build shared first, then the portal
RUN pnpm --filter @announcement/shared build
RUN pnpm --filter @announcement/web-portal build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/apps/web-portal/.next/standalone ./
COPY --from=builder /app/apps/web-portal/.next/static ./apps/web-portal/.next/static
COPY --from=builder /app/apps/web-portal/public ./apps/web-portal/public

EXPOSE 3000
CMD ["node", "apps/web-portal/server.js"]

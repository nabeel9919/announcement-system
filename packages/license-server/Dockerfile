# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl && npm install -g pnpm@9.15.9

# Copy workspace manifests (layer cache — only reinstall when these change)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/license-server/package.json ./packages/license-server/

RUN pnpm install --no-frozen-lockfile

# Build @announcement/shared first (license-server depends on it)
COPY packages/shared ./packages/shared
RUN pnpm --filter @announcement/shared build

# Build license server
COPY packages/license-server ./packages/license-server
RUN pnpm --filter @announcement/license-server build

# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl && npm install -g pnpm@9.15.9

# Copy workspace manifests and install production deps only
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/license-server/package.json ./packages/license-server/
RUN pnpm install --no-frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/license-server/dist ./packages/license-server/dist

# Schema + migrations (needed for migrate deploy + prisma generate)
COPY packages/license-server/src/db/schema.prisma ./packages/license-server/src/db/schema.prisma
COPY packages/license-server/src/db/migrations ./packages/license-server/src/db/migrations

# Generate Prisma client in the runner stage (avoids pnpm virtual store path issues)
RUN cd packages/license-server && npx prisma@5 generate --schema=src/db/schema.prisma

# Entrypoint script
COPY packages/license-server/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

ENTRYPOINT ["/docker-entrypoint.sh"]

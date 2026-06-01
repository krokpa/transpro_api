# ============================================================
# TransPro API — Multi-stage Dockerfile
# Build context : racine du monorepo
#   docker build -f apps/api/Dockerfile -t transpro-api .
# ============================================================

# ── Base ─────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@11 --activate

# ── Dépendances (cached layer) ────────────────────────────────
FROM base AS deps
WORKDIR /monorepo

# Copier les manifestes en premier pour profiter du cache Docker
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json   ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json          ./apps/api/

RUN pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /monorepo

# Sources
COPY packages/shared/   ./packages/shared/
COPY packages/database/ ./packages/database/
COPY apps/api/          ./apps/api/

# Ordre de build : shared → database → api
RUN pnpm --filter @transpro/shared   build
RUN pnpm --filter @transpro/database build
# Génère le client Prisma pour l'image alpine du builder
RUN pnpm --filter @transpro/database exec prisma generate
# Build NestJS
RUN pnpm --filter @transpro/api      build

# pnpm deploy crée un dossier autonome :
# - toutes les dépendances prod résolues (node_modules plat)
# - les packages workspace (@transpro/shared, @transpro/database)
#   sont copiés avec leur dist/ inclus
RUN pnpm deploy --filter @transpro/api --prod /deploy/api

# ── Runtime (image finale slim) ───────────────────────────────
FROM node:20-alpine AS runner

# Utilisateur non-root pour la sécurité
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

WORKDIR /app

# Dépendances de prod depuis le déploiement pnpm
COPY --from=builder --chown=nestjs:nodejs /deploy/api/node_modules ./node_modules

# Build compilé
COPY --from=builder --chown=nestjs:nodejs /monorepo/apps/api/dist ./dist

# Schéma Prisma (requis pour prisma generate dans l'image runner)
COPY --from=builder --chown=nestjs:nodejs /monorepo/packages/database/prisma ./prisma

# Re-générer le client Prisma pour l'image alpine runner
# (le binaire engine est OS-spécifique)
RUN npx prisma generate --schema=./prisma/schema.prisma \
    && chown -R nestjs:nodejs /app

USER nestjs

ENV NODE_ENV=production
EXPOSE 3001

# Exécuter la migration DB avant le démarrage (optionnel en prod)
# CMD ["sh", "-c", "npx prisma db push --schema=./prisma/schema.prisma && node dist/main"]
CMD ["node", "dist/main"]

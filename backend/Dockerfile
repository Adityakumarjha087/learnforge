# syntax=docker/dockerfile:1.7
# Build context: repository root (npm workspaces).
FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --include-workspace-root --no-audit --no-fund
COPY backend backend
RUN npx prisma generate --schema backend/prisma/schema.prisma \
 && npm run build -w backend \
 && npm prune --omit=dev -w backend --include-workspace-root --no-audit --no-fund

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
COPY --from=build --chown=node:node /app/backend/prisma/seed-data/photosynthesis-notes.md ./backend/dist/seed-data/photosynthesis-notes.md
COPY --chown=node:node backend/docker-entrypoint.sh ./backend/docker-entrypoint.sh
WORKDIR /app/backend
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --retries=20 --start-period=20s CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "sh", "./docker-entrypoint.sh"]

# syntax=docker/dockerfile:1.7
# Build context: repository root (the frontend imports the backend's tRPC router *types*).
FROM node:24-alpine AS build
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY backend backend
COPY frontend frontend
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_WS_URL=http://localhost:21001
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate --schema backend/prisma/schema.prisma && npm run build -w frontend

FROM node:24-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=20 --start-period=15s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "frontend/server.js"]

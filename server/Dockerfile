# syntax=docker/dockerfile:1
# ---------- bagimliliklar ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- derleme ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json tsconfig.build.json package.json ./
COPY src ./src
RUN npm run build

# ---------- calisma zamani ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# .sql dosyalari tsc tarafindan kopyalanmaz; migrate.js bunlari yaninda arar.
COPY src/infrastructure/db/migrations ./dist/infrastructure/db/migrations

USER node
EXPOSE 4000

HEALTHCHECK --interval=20s --timeout=4s --start-period=20s --retries=5   CMD wget -q -O /dev/null http://127.0.0.1:4000/api/health || exit 1

# tini: PID 1 olarak sinyalleri dogru iletir (zarif kapanma)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main/api.js"]

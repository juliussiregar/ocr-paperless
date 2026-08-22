FROM node:22-alpine AS builder

WORKDIR /app

COPY sync-worker/package.json sync-worker/package-lock.json ./sync-worker/
WORKDIR /app/sync-worker
RUN npm ci

COPY prisma /app/prisma
COPY sync-worker/ ./
RUN npx prisma generate --schema=/app/prisma/schema.docker.prisma \
  && npm run build

FROM node:22-alpine

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app/sync-worker

COPY --from=builder /app/sync-worker/node_modules ./node_modules
COPY --from=builder /app/sync-worker/dist ./dist
COPY --from=builder /app/sync-worker/package.json ./
COPY --from=builder /app/sync-worker/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/sync-worker/node_modules/@prisma ./node_modules/@prisma

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

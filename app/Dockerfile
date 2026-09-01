FROM node:22-alpine AS builder

WORKDIR /app

COPY app/package.json app/package-lock.json ./app/
WORKDIR /app/app
RUN npm install

COPY prisma /app/prisma
COPY app/ ./
# Single-generator schema for Docker (avoids multi-client auto-install OOM on small VPS)
RUN npx prisma generate --schema=/app/prisma/schema.docker.prisma
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=768
RUN npm run build
# Fresh prisma CLI install so all transitive deps (dotenv, defu, c12, ...) are present.
RUN mkdir -p /prisma-bundle \
  && cd /prisma-bundle \
  && npm init -y >/dev/null \
  && npm install prisma@6.19.3 --omit=dev --no-fund --no-audit \
  && cp -a /app/app/node_modules/.prisma /prisma-bundle/node_modules/ \
  && cp -a /app/app/node_modules/@prisma/client /prisma-bundle/node_modules/@prisma/ \
  && cp -a /app/app/node_modules/bcryptjs /prisma-bundle/node_modules/

FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next standalone from /app/app usually emits server.js at standalone root
COPY --from=builder /app/app/.next/standalone ./
COPY --from=builder /app/app/.next/static ./.next/static
COPY --from=builder /app/app/public ./public
COPY --from=builder /app/app/data ./data

# Merge prisma CLI + client into node_modules (alongside standalone deps)
COPY --from=builder /prisma-bundle/node_modules/ ./node_modules/
COPY --from=builder /app/prisma /app/prisma

COPY app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app

USER nextjs
WORKDIR /app

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["sh", "docker-entrypoint.sh"]

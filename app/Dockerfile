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
# Bundle prisma CLI + runtime deps needed at container start (migrate/db push).
# Prefer copying prisma's own node_modules tree so transitive deps (defu, etc.) are not missed.
RUN mkdir -p /prisma-bundle \
  && cp -a node_modules/prisma node_modules/@prisma node_modules/.prisma /prisma-bundle/ \
  && if [ -d node_modules/prisma/node_modules ]; then \
       mkdir -p /prisma-bundle/prisma/node_modules \
       && cp -a node_modules/prisma/node_modules/. /prisma-bundle/prisma/node_modules/; \
     fi \
  && for pkg in effect jiti pathe deepmerge-ts fast-check pure-rand \
       empathetic c12 confbox destr defu exsolve giget node-fetch-native nypm \
       ohash perfect-debounce pkg-types rc9 readdirp tinyexec tinyglobby \
       empathic @standard-schema citty consola knitwork; do \
       if [ -e "node_modules/$pkg" ]; then cp -a "node_modules/$pkg" /prisma-bundle/; fi; \
     done \
  && cp -a node_modules/bcryptjs /prisma-bundle/

FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/app/.next/standalone ./
COPY --from=builder /app/app/.next/static ./app/.next/static
COPY --from=builder /app/app/public ./app/public

COPY --from=builder /prisma-bundle/ ./app/node_modules/
COPY --from=builder /app/prisma /app/prisma

COPY app/docker-entrypoint.sh /app/app/docker-entrypoint.sh
RUN chmod +x /app/app/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app

USER nextjs
WORKDIR /app/app

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["sh", "docker-entrypoint.sh"]

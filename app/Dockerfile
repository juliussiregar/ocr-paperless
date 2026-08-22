FROM node:22-alpine AS builder

WORKDIR /app

COPY app/package.json app/package-lock.json ./app/
WORKDIR /app/app
RUN npm install

COPY prisma /app/prisma/
COPY app/ ./

RUN npx prisma generate --schema=/app/prisma/schema.prisma
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next standalone nests under app/ (config lives in app/)
COPY --from=builder /app/app/.next/standalone ./
COPY --from=builder /app/app/.next/static ./app/.next/static
COPY --from=builder /app/app/public ./app/public

# Prisma CLI + client engines (migrate / seed)
COPY --from=builder /app/app/node_modules/prisma ./app/node_modules/prisma
COPY --from=builder /app/app/node_modules/@prisma ./app/node_modules/@prisma
COPY --from=builder /app/app/node_modules/.prisma ./app/node_modules/.prisma
COPY --from=builder /app/prisma /app/prisma

# Seed runtime deps (not always traced into standalone)
COPY --from=builder /app/app/node_modules/bcryptjs ./app/node_modules/bcryptjs

COPY app/docker-entrypoint.sh /app/app/docker-entrypoint.sh
RUN chmod +x /app/app/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app

USER nextjs
WORKDIR /app/app

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["sh", "docker-entrypoint.sh"]

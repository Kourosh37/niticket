FROM oven/bun:1.4.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS runtime
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

FROM runtime AS dependencies
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
RUN --mount=type=cache,id=niticket-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --network-concurrency=8

FROM dependencies AS tools
COPY . .
RUN bun run db:generate
RUN mkdir -p apps/web/.next node_modules/.vite-temp node_modules/.vite \
    && chown -R bun:bun apps/web node_modules/.prisma \
    && chown bun:bun node_modules/.vite-temp node_modules/.vite
USER bun

FROM tools AS build
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --cwd apps/web build

FROM runtime AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=bun:bun /app/apps/web/.next/standalone ./
COPY --from=build --chown=bun:bun /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=bun:bun /app/apps/web/public ./apps/web/public
USER bun
EXPOSE 3000
CMD ["bun","apps/web/server.js"]

FROM runtime AS production-dependencies
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
RUN --mount=type=cache,id=niticket-bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts --network-concurrency=8

FROM runtime AS worker
RUN apk add --no-cache ffmpeg
COPY --from=production-dependencies --chown=bun:bun /app /app
COPY --from=tools --chown=bun:bun /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=tools --chown=bun:bun /app/packages /app/packages
COPY --from=tools --chown=bun:bun /app/apps/worker /app/apps/worker
COPY --from=tools --chown=bun:bun /app/tsconfig.json /app/tsconfig.json
ENV NODE_ENV=production SERVICE_NAME=niticket-worker
USER bun
CMD ["bun","apps/worker/src/index.ts"]

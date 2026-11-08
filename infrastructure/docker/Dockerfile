FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl ca-certificates

FROM runtime AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@11.5.1
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
RUN --mount=type=cache,id=niticket-pnpm-store,target=/pnpm/store \
    pnpm install --store-dir=/pnpm/store --prefer-offline --frozen-lockfile --network-concurrency=4 --child-concurrency=1

FROM dependencies AS tools
COPY . .
RUN pnpm db:generate
RUN mkdir -p apps/web/.next && chown -R node:node apps/web
USER node

FROM tools AS build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @niticket/web build

FROM runtime AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node","apps/web/server.js"]

FROM base AS worker
RUN apk add --no-cache ffmpeg
COPY --from=tools --chown=node:node /app /app
ENV NODE_ENV=production SERVICE_NAME=niticket-worker
USER node
CMD ["node","--import","tsx","apps/worker/src/index.ts"]

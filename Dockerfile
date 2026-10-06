# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
# same major as local dev; pnpm 11+ ignores pnpm.onlyBuiltDependencies
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
# better-sqlite3 13 has no prebuilds: compile it here, the runtime stage stays toolchain-free
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# separate stage on the same base so better-sqlite3's native build matches the runtime
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 HOST=0.0.0.0
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.ts ./
COPY --from=build /app/build ./build
COPY src/lib/server ./src/lib/server
# shared modules the unbundled server code imports: file rules (files.ts), user colors (projects.ts)
COPY src/lib/files.ts src/lib/presence.ts ./src/lib/
COPY drizzle ./drizzle
# static docker CLI: compiles run as sibling containers through the mounted host socket (research R4)
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.ts"]

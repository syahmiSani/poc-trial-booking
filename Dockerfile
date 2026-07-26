# Trial booking POC.
#
# Multi-stage so the published image carries the built server and the .sql
# files, but none of the toolchain used to produce them.

# ---- build ----------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Next reads next.config.mjs (output: "standalone") and emits a self-contained
# server under .next/standalone with only the traced modules.
RUN npm run build

# ---- run ------------------------------------------------------------------
FROM node:20-alpine AS run
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_SQL_DIR=/app/db

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# The app reads these at runtime: the /testing console reseeds from them, and
# the startup script applies them. File tracing cannot see them, so copy
# explicitly.
COPY --from=build /app/db ./db
COPY --from=build /app/scripts/init-db.mjs ./scripts/init-db.mjs

# `pg` is the only runtime dependency the init script needs that standalone
# tracing might not have hoisted to the top level.
COPY --from=build /app/node_modules/pg ./node_modules/pg
COPY --from=build /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=build /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=build /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=build /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=build /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=build /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=build /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=build /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=build /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=build /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=build /app/node_modules/split2 ./node_modules/split2

EXPOSE 3000

# Seed an empty database, then serve. Both steps are idempotent.
CMD ["sh", "-c", "node scripts/init-db.mjs && node server.js"]

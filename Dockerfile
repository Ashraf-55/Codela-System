# syntax=docker/dockerfile:1
# One image, two processes: `api` (Express + SQLite) and `web` (Next.js). docker-compose.yml starts each with its own command.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/design/package.json packages/design/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY . .
ARG API_URL=http://api:4000
ARG ROOT_DOMAIN=localhost
ENV API_URL=$API_URL ROOT_DOMAIN=$ROOT_DOMAIN NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app /app
# data (SQLite, uploads, backups) lives on a volume, never inside the image
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000 4000
# health checks are defined per service in docker-compose.yml (the same image runs both processes)
CMD ["npm", "run", "start:api"]

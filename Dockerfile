FROM node:22-alpine AS deps
WORKDIR /app
# The Apple Music client is installed from its Git repository.
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ARG APP_REVISION=unknown
ENV NODE_ENV=production
ENV PORT=3000
ENV APP_REVISION=${APP_REVISION}

LABEL org.opencontainers.image.revision=${APP_REVISION}

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node migrations ./migrations

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:3000/health"]
# If migrations fail the service never starts, /health never reports the new revision and the deploy fails.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]

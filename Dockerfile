FROM node:22-alpine AS deps
WORKDIR /app
# The Apple Music client is installed from its Git repository.
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=2048
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ARG APP_REVISION=unknown
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV APP_REVISION=${APP_REVISION}

LABEL org.opencontainers.image.revision=${APP_REVISION}

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --chown=node:node migrations ./migrations

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:3000/api/health"]
# Migrations run when the server starts. If they fail, /health never reports the new revision and the deploy fails.
CMD ["node", "server.js"]

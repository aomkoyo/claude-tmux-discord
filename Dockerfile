FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY prisma ./prisma
COPY cli/package.json cli/tsconfig.json ./cli/
COPY cli/src ./cli/src

RUN cd cli && pnpm install && pnpm build
RUN pnpm install --frozen-lockfile
RUN pnpm prisma generate

COPY src ./src
RUN pnpm exec tsc -p tsconfig.json
RUN mkdir -p dist/generated && cp -r src/generated/* dist/generated/

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      tmux \
      ca-certificates \
      git \
      curl \
      tini \
      openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm add -g @anthropic-ai/claude-code

WORKDIR /app

# Copy entire node_modules from builder (includes prisma CLI + all deps)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/cli/dist ./cli/dist
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated

COPY package.json pnpm-workspace.yaml ./
COPY cli/package.json ./cli/
COPY prisma ./prisma

ENV PATH="/app/node_modules/.bin:${PATH}"
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace
ENV DATABASE_URL=file:/data/state.db

RUN mkdir -p /workspace /data /home/node/.claude \
    && chown -R node:node /workspace /data /home/node/.claude /app
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/index.js"]

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Install the locked, original Workspace/Pi dependencies and build its real UI.
# Explicit COPY avoids packaging an untracked private .env or local data tree.
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.mjs ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    WORKSPACE_ACCESS_MODE=enterprise \
    WORKSPACE_RUNTIME=pi \
    WORKSPACE_DATA_DIR=/data \
    PORT=8787 \
    WS_AGENT_ENABLED=1 \
    WS_AGENT_DEMO=0 \
    WS_AGENT_RESEARCH_ENABLED=0 \
    WORKSPACE_SUPPLIER_SHOPIFY_WRITES_ENABLED=0
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node presets ./presets
COPY --chown=node:node client ./client
COPY --chown=node:node scripts ./scripts
RUN install -d -o node -g node -m 0700 /data
USER node
VOLUME /data
# The original app only binds loopback. On a reviewed Linux host use host
# networking with the existing same-host authenticated TLS ingress. Do not
# change the app to 0.0.0.0 or expose a second Agent port.
CMD ["node", "server/index.mjs"]

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
ENV MEDUSA_DISABLE_TELEMETRY=true
WORKDIR /source
COPY packages/medusa-enterprise-product-context/package*.json packages/medusa-enterprise-product-context/
RUN npm ci --prefix packages/medusa-enterprise-product-context --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000
COPY packages/medusa-enterprise-product-context/src packages/medusa-enterprise-product-context/src
COPY packages/medusa-enterprise-product-context/tsconfig.json packages/medusa-enterprise-product-context/
RUN npm run build --prefix packages/medusa-enterprise-product-context
COPY apps/medusa-acceptance/package*.json apps/medusa-acceptance/
RUN npm pack ./packages/medusa-enterprise-product-context --pack-destination apps/medusa-acceptance \
 && npm ci --prefix apps/medusa-acceptance --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000
COPY apps/medusa-acceptance/medusa-config.ts apps/medusa-acceptance/tsconfig.json apps/medusa-acceptance/
RUN JWT_SECRET=build-only-not-a-service-secret COOKIE_SECRET=build-only-not-a-service-secret \
 DATABASE_URL=postgres://build:build@127.0.0.1/build REDIS_URL=redis://127.0.0.1:6379 \
 npm run build --prefix apps/medusa-acceptance

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
ENV NODE_ENV=production MEDUSA_DISABLE_TELEMETRY=true NODE_OPTIONS=--max-old-space-size=1280
WORKDIR /app
COPY --from=build --chown=node:node /source/apps/medusa-acceptance/.medusa/server/ /app/
COPY --from=build --chown=node:node /source/apps/medusa-acceptance/node_modules/ /app/node_modules/
COPY --chown=node:node acceptance/medusa/entrypoint.mjs acceptance/medusa/create-user.mjs /opt/medusa/
RUN mkdir -p /app/static /app/.cache && chown -R node:node /app/static /app/.cache
USER node
EXPOSE 9000
ENTRYPOINT ["node", "/opt/medusa/entrypoint.mjs"]
CMD ["serve"]

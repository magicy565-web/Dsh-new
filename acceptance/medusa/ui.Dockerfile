FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
ENV MEDUSA_DISABLE_TELEMETRY=true
WORKDIR /source
RUN node --version && npm --version
COPY --chmod=0600 packages/medusa-enterprise-product-context/package*.json packages/medusa-enterprise-product-context/
RUN npm ci --prefix packages/medusa-enterprise-product-context --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000
COPY packages/medusa-enterprise-product-context/src packages/medusa-enterprise-product-context/src
COPY packages/medusa-enterprise-product-context/tsconfig.json packages/medusa-enterprise-product-context/
COPY --chmod=0600 packages/medusa-enterprise-product-context/README.md packages/medusa-enterprise-product-context/
# The locked local archive was built with private generated-file modes (0600).
# Keep that metadata deterministic as well as the implicitly packed README.
RUN umask 077 && npm run build --prefix packages/medusa-enterprise-product-context
COPY apps/medusa-acceptance/package*.json apps/medusa-acceptance/
RUN npm pack ./packages/medusa-enterprise-product-context --pack-destination apps/medusa-acceptance \
 && npm ci --prefix apps/medusa-acceptance --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000
# Keep the backend configuration and its audited provider closure unchanged.
# Only the build-stage copy receives the exact checked Admin options.
COPY apps/medusa-acceptance/medusa-config.ts apps/medusa-acceptance/
COPY apps/medusa-acceptance/tsconfig.json apps/medusa-acceptance/
COPY acceptance/medusa/prepare-admin-static-config.mjs acceptance/medusa/
RUN node acceptance/medusa/prepare-admin-static-config.mjs apps/medusa-acceptance/medusa-config.ts
RUN JWT_SECRET=build-only-not-a-service-secret COOKIE_SECRET=build-only-not-a-service-secret \
 DATABASE_URL=postgres://build:build@127.0.0.1/build REDIS_URL=redis://127.0.0.1:6379 \
 npm run build --prefix apps/medusa-acceptance -- --admin-only \
 && test -s apps/medusa-acceptance/.medusa/admin/index.html

FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8
COPY acceptance/medusa/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /source/apps/medusa-acceptance/.medusa/admin/ /usr/share/nginx/html/dashboard/
USER 101
EXPOSE 8080

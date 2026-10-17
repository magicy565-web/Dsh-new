FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build
WORKDIR /ui
COPY apps/medusa-product-catalog/package*.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000
COPY apps/medusa-product-catalog/ ./
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8
COPY acceptance/medusa/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /ui/dist/ /usr/share/nginx/html/
USER 101
EXPOSE 8080

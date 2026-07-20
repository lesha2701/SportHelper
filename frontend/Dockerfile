# Build context is frontend/ (see docker-compose.yml).
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Vite inlines import.meta.env.* at build time, so the backend's public URL
# must be known now, not at container start. Passed via docker-compose
# `args:` (which reads it from the host's .env.production).
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# --- Serve the static build + reverse-proxy /api to the backend ------------
FROM caddy:2-alpine

COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

# -----------------------------------------------------------------------------
# Frontend image: builds the React app, then serves it with nginx.
# nginx also forwards /api/* to the API gateway, so the browser only ever talks
# to one origin (no CORS, only port 80 needs to be open).
#
#   docker build -t banking/web ./frontend
# -----------------------------------------------------------------------------

# ---------- Stage 1: build static files ----------
FROM node:20.17-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Real API mode; empty base URL = same origin (/api/... handled by nginx)
ENV VITE_USE_MOCK=false \
    VITE_API_BASE_URL=
RUN npm run build

# ---------- Stage 2: nginx ----------
FROM nginx:1.27.1-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

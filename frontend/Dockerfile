# SoulLog frontend.
#
# Builds the Vite bundle, then serves the static output with nginx. The
# built app is plain files — there is no Node process in the runtime
# image, because there is nothing for it to do.

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies are installed from the lockfile before the source is copied
# so that a source-only change doesn't reinstall everything.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines env vars at build time, so the API URL is a build argument
# rather than a runtime one. A deployment that changes it rebuilds.
ARG VITE_API_BASE_URL=http://localhost:8000/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

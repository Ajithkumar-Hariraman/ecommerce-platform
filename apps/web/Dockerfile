FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_KEYCLOAK_URL=
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ARG API_UPSTREAM=http://api:3000
ARG API_HOST=api
RUN sed -i "s|__API_UPSTREAM__|${API_UPSTREAM}|g; s|__API_HOST__|${API_HOST}|g" nginx.conf
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

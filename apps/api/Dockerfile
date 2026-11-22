FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY scripts/patch-kafkajs-timer.cjs ./scripts/patch-kafkajs-timer.cjs
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run typecheck && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY package*.json ./
COPY scripts/patch-kafkajs-timer.cjs ./scripts/patch-kafkajs-timer.cjs
RUN npm ci --omit=dev && rm scripts/patch-kafkajs-timer.cjs && rmdir scripts && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node certs ./certs
COPY --chown=node:node assets/local-catalog ./assets/local-catalog
RUN install -d -o node -g node /app/local-product-images
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/server.js"]

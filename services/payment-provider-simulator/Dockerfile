FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4100 PAYMENT_DATABASE_PATH=/data/payments.sqlite
EXPOSE 4100
CMD ["node", "server.mjs"]

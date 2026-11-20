FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/idoknow/guilinol
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server server
COPY lib lib
COPY functions functions
USER node
CMD ["node","--import","tsx","server/index.mjs"]

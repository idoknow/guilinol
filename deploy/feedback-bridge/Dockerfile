FROM node:22-bookworm-slim
WORKDIR /app
COPY multica gh /usr/local/bin/
COPY scripts scripts
COPY docs docs
COPY pipeline pipeline
COPY entrypoint.sh /app/entrypoint.sh
RUN command -v flock && /usr/local/bin/gh --version && /usr/local/bin/multica version
USER node
ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]

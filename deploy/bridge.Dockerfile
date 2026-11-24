# Feedback bridge image, built by .github/workflows/glol-images.yml from the repo root.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ARG MULTICA_VERSION=0.11.1
ARG MULTICA_SHA256=e59fd0db93bb184cc5349ff60d0d982f8d2ce46355269bec879eb12dfe61c003
ADD https://github.com/multica-ai/multica/releases/download/v${MULTICA_VERSION}/multica-cli-${MULTICA_VERSION}-linux-amd64.tar.gz /tmp/multica.tgz
RUN echo "${MULTICA_SHA256}  /tmp/multica.tgz" | sha256sum -c - \
  && tar -xzf /tmp/multica.tgz -C /usr/local/bin multica && rm /tmp/multica.tgz \
  && chmod 755 /usr/local/bin/multica && command -v flock && multica version
WORKDIR /app
COPY scripts/feedback-bridge.mjs scripts/feedback-bridge.mjs
COPY docs/feedback-modelling-task.md docs/feedback-modelling-task.md
COPY pipeline/landmarks.json pipeline/landmark-refs.json pipeline/
COPY deploy/feedback-bridge/entrypoint.sh /app/entrypoint.sh
USER node
ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]

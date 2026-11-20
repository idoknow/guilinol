#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${MULTICA_CLI_PATH:?daemon-matched Multica executable required}"
context=$(mktemp -d)
trap 'rm -rf "$context"' EXIT
install -m755 "$MULTICA_CLI_PATH" "$context/multica"
install -m755 /usr/bin/gh "$context/gh"
for file in scripts/feedback-bridge.mjs docs/feedback-modelling-task.md pipeline/{landmarks,landmark-refs}.json; do
  install -Dm644 "$file" "$context/$file"
done
cp deploy/feedback-bridge/{Dockerfile,entrypoint.sh} "$context/"
docker build -t "ghcr.io/idoknow/glol-feedback-bridge:$(git rev-parse HEAD)" "$context"

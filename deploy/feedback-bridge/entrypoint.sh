#!/bin/sh
set -eu
umask 077
home=$(mktemp -d)
trap 'rm -rf "$home"' EXIT
mkdir "$home/.multica"
for file in /run/glol/cli-*; do
  name=${file##*/cli-}
  cp -L "$file" "$home/.multica/$name"
done
test -s "$home/.multica/config.json"
for name in MULTICA_WORKSPACE_ID GH_TOKEN BRIDGE_TOKEN BRIDGE_ENABLED BRIDGE_PROJECT BRIDGE_PARENT BRIDGE_ORIGIN; do
  test -s "/run/glol/$name" || exit 1
done
agent=$(cat /run/glol/BRIDGE_AGENT)
test "$agent" = d0320da1-ce8c-470a-a5a7-1976261a067d
exec_clean() {
  env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$home" \
    MULTICA_CLI_PATH=/usr/local/bin/multica MULTICA_WORKSPACE_ID="$(cat /run/glol/MULTICA_WORKSPACE_ID)" \
    GH_TOKEN="$(cat /run/glol/GH_TOKEN)" BRIDGE_TOKEN="$(cat /run/glol/BRIDGE_TOKEN)" \
    BRIDGE_AGENT="$agent" BRIDGE_ENABLED="$(cat /run/glol/BRIDGE_ENABLED)" \
    BRIDGE_PROJECT="$(cat /run/glol/BRIDGE_PROJECT)" BRIDGE_PARENT="$(cat /run/glol/BRIDGE_PARENT)" \
    BRIDGE_ORIGIN="$(cat /run/glol/BRIDGE_ORIGIN)" BRIDGE_STATE=/state "$@"
}
exec_clean node scripts/feedback-bridge.mjs "$@"

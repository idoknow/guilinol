#!/bin/sh
set -eu
root=$(git rev-parse --show-toplevel)
tracked=$(git -C "$root" ls-files -- docs/layout)
if [ -n "$tracked" ]; then
    printf 'Move modelling inputs to pipeline/data/layout and evidence to ops:\n%s\n' "$tracked" >&2
    exit 1
fi

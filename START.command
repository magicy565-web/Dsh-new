#!/bin/sh
cd "$(dirname "$0")" || exit 1
node --env-file-if-exists=.env server/index.mjs

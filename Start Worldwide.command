#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null; then
  echo 'Install Node.js 22.18 or newer from https://nodejs.org, then open this launcher again.'
  read '?Press Return to close.'
  exit 1
fi
node scripts/start-local.mjs
if [[ $? -ne 0 ]]; then read '?Press Return to close.'; fi

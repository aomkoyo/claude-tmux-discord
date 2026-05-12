#!/bin/sh
set -e

# Ensure claude auth directory is writable
if [ -d /home/node/.claude ] && [ ! -w /home/node/.claude ]; then
  echo "WARNING: /home/node/.claude is not writable — Claude login may fail"
fi

# Run prisma migrations
pnpm prisma migrate deploy 2>/dev/null || echo "WARN: prisma migrate deploy failed (first run?)"

# Start the bot
exec node dist/index.js

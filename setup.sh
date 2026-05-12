#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

echo "claude-tmux-discord setup"
echo "========================="
echo ""

errors=0

# Node.js
if command -v node &>/dev/null; then
  ver=$(node -v | sed 's/v//')
  major=$(echo "$ver" | cut -d. -f1)
  if [ "$major" -ge 22 ]; then
    ok "Node.js $ver"
  else
    fail "Node.js $ver (need >= 22)"
    errors=$((errors + 1))
  fi
else
  fail "Node.js not found (need >= 22)"
  errors=$((errors + 1))
fi

# pnpm
if command -v pnpm &>/dev/null; then
  ok "pnpm $(pnpm -v)"
else
  warn "pnpm not found — enabling via corepack"
  corepack enable 2>/dev/null && ok "pnpm enabled via corepack" || { fail "corepack enable failed"; errors=$((errors + 1)); }
fi

# tmux
if command -v tmux &>/dev/null; then
  ok "tmux $(tmux -V | awk '{print $2}')"
else
  fail "tmux not found — install it: sudo apt install tmux"
  errors=$((errors + 1))
fi

# claude
if command -v claude &>/dev/null; then
  ok "claude CLI found"
else
  warn "claude CLI not found — install: pnpm add -g @anthropic-ai/claude-code"
fi

echo ""

if [ "$errors" -gt 0 ]; then
  echo -e "${RED}$errors required dependency missing. Fix the above and re-run.${NC}"
  exit 1
fi

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
  echo ""
  echo -e "  ${YELLOW}Edit .env and set DISCORD_TOKEN before starting.${NC}"
else
  ok ".env already exists"
fi

# Install deps
echo ""
echo "Installing dependencies..."
pnpm install

# Build
echo ""
echo "Building..."
pnpm build

# Directories
mkdir -p workspace data
ok "Created workspace/ and data/ directories"

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env and set DISCORD_TOKEN"
echo "  2. Run: pnpm start"
echo "  3. Or dev mode: pnpm dev"

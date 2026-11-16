#!/usr/bin/env bash
# Deploy The Book Nook (site/) and Harbor Delivery Co. (peer/) to Cloudflare
# Pages (free tier). No config edits needed: the repo already points at the
# production URLs (site: https://booknook.pages.dev, peer:
# https://harbor-delivery.pages.dev, see site/links.json + both agent cards).
#
# Prerequisites (one-time, done by the parent agent):
#   - A Cloudflare account (free tier) — browser task in progress as of
#     2026-11-17; credentials land in ~/workspace/makefun/accounts-created.json
#   - An API token with Pages:Edit + Account:Read, saved as
#     CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) in the environment
#     or in ~/.config/cloudflare/token (mode 600). NEVER commit a token.
#   - `npx wrangler` fetches wrangler on first use; no install needed.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bash deploy.sh
# Then verify the live sites:
#   node tests/verify-public.mjs https://booknook.pages.dev https://harbor-delivery.pages.dev
set -euo pipefail
cd "$(dirname "$0")"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (Cloudflare API token with Pages:Edit).}"
export CLOUDFLARE_API_TOKEN
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then export CLOUDFLARE_ACCOUNT_ID; fi

echo "== Deploying Book Nook (site/) as project 'booknook' =="
npx -y wrangler pages deploy site --project-name booknook --commit-dirty=true

echo "== Deploying Harbor Delivery Co. (peer/) as project 'harbor-delivery' =="
npx -y wrangler pages deploy peer --project-name harbor-delivery --commit-dirty=true

echo "== Deployed =="
echo "Shop:  https://booknook.pages.dev/?peer=https://harbor-delivery.pages.dev/delivery"
echo "Peer:  https://harbor-delivery.pages.dev/"
echo "Next:  node tests/verify-public.mjs https://booknook.pages.dev https://harbor-delivery.pages.dev"

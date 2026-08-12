# Single source of truth for the production Content-Security-Policy.
# Included by nginx/prod.conf (edge) AND frontend/nginx.prod.conf (static container).
# Keep in sync with frontend/nginx/snippets/csp.inc — enforced by nginx/snippets/check-csp-sync.mjs.
#
# Do not add a stricter CSP at CDN/edge without media-src blob: — multiple CSP headers
# intersect and would break video (object URLs).
# script-src: no 'unsafe-inline' (IMP-AUDIT-04) — Vite prod index.html has only external scripts.
# TON Connect: bridge hostnames must stay aligned with https://config.ton.org/wallets-v2.json.
# Ton Center — client jetton/TON RPC; update connect-src when VITE_TON_RPC_URL or network changes.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self' https://burnedchats.net https://*.burnedchats.net wss://burnedchats.net wss://*.burnedchats.net https://telegram.org https://config.ton.org https://bridge.tonapi.io wss://bridge.tonapi.io https://tonconnectbridge.mytonwallet.org wss://tonconnectbridge.mytonwallet.org https://bridge.tonhub.com wss://bridge.tonhub.com https://walletbot.me wss://walletbot.me https://toncenter.com https://testnet.toncenter.com https://tonkeeper.com https://*.tonkeeper.com; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-ancestors 'self' https://web.telegram.org https://telegram.org;" always;

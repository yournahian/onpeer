# OnPeer architecture

OnPeer is a React + Vite app on **Arc Testnet** (chain id 5042002, USDC is the gas token and the ERC-20 at `0x3600000000000000000000000000000000000000`, 6 decimals). It has four product areas that share one wallet connection, one theme and one shell:

| Area | Route | What it is | Where the logic lives |
|---|---|---|---|
| P2P | `/p2p` | Escrow marketplace for USDC against 8 South Asian currencies | `contracts/P2PEscrow.sol` + `src/pages/P2P.tsx` and friends |
| Swap | `/swap` | USDC <-> EURC on Arc Testnet | Circle App Kit, `src/pages/Swap.tsx`, `src/hooks/useSwapFlow.ts` |
| Bridge | `/bridge` | USDC across 7 testnets (CCTP) | Circle App Kit, `src/pages/Bridge.tsx`, `src/hooks/useBridgeFlow.ts` |
| Assistant | `/assistant` + floating panel | Chat that finds ads and prepares swaps, bridges and trades | `worker/index.ts` (AI proxy, IP rate-limited) + `src/agent/*` + `src/components/chat/*` |
| Admin | `/admin` | Owner and arbiter console: disputes, filings, job health, accounts, controls, AI provider | `src/pages/Admin.tsx`, `src/components/admin/*` |
| Privacy | `/privacy` | Encryption trust disclosure, Didit sandbox notice, retention schedule | `src/pages/Privacy.tsx` |

### Phase 2 Backend (`worker/` + Supabase Postgres via Hyperdrive)

All `/api/*` routes are served by the **Cloudflare Worker** (`worker/index.ts`), backed by **Supabase Postgres** via **Cloudflare Hyperdrive** (`HYPERDRIVE` binding) using `node-postgres` (`pg`). Row Level Security is enabled on all 13 tables in `db/migrations/0001_init.sql` (and `0002_phase2_fixes.sql`), with table ownership held by `postgres`, explicit RLS policies granted only to the least-privilege `onpeer_worker` role (`audit_log` is strictly append-only), and all privileges revoked from `anon` and `authenticated`. No Supabase key ever reaches the browser. The legacy Bun server (`server/index.ts`) is deprecated and no longer wired to Vite or production.

- **Auth (`worker/auth.ts`):** Wallet-signature login (`POST /api/auth/nonce`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) using single-use DB-consumed nonces and 12-hour opaque session tokens stored only as SHA-256 hashes in `public.sessions`. Every order/admin route verifies roles live onchain (`worker/chain.ts`).
- **Envelope Encryption (`worker/crypto.ts`):** AES-256-GCM envelope encryption with a fresh 256-bit DEK and 96-bit random IV per record, a 1-byte key ID (`v2`) for future master-key rotation, AAD context binding, and `keccak256(ciphertext)` commitments (`detailsHash`, `payerProof`). **Trust trade-off:** The master key is held by the platform operator in Cloudflare Worker secrets, protecting data from public blockchain scraping, third parties, and database leaks, while allowing the operator technical decryption capability (disclosed in `/privacy`). True browser E2EE (`detailsMode 1`) is reserved for a later phase.
- **P2P Accounts & Email (`worker/accounts.ts`, `worker/notify.ts`):** Encrypted profile/email, consent timestamp, double opt-in verification via `#fragment` HMAC link, 180-day signed unsubscribe link, Resend delivery with `claimed_at` lease and exponential `send_after` backoff, and `DELETE /api/account` PII scrubbing + verification revocation.
- **Didit Sandbox KYC (`worker/kyc.ts`):** `POST /v3/session/` (`vendor_data` = lowercase wallet, `callback` = `/p2p?kyc_return=1`, `sandbox_scenario` gated strictly to `DIDIT_MODE=sandbox`). Webhook (`POST /api/kyc/webhook`) verifies `X-Timestamp` (<= 300s skew) and `X-Signature-V2` (canonical JSON HMAC-SHA256 in constant time), requires an existing `kyc_sessions` row, deduplicates `event_id` inside the same DB transaction, stores `approved_session_id` (only revoking on matching session, never on `abandoned`), performs strict token-based name matching (exact or distance 1 only for tokens >= 6 chars), and relays `setVerification`/`revokeVerification` via the isolated `VERIFIER_PRIVATE_KEY` wallet.
- **Vault, Evidence, Chat & Disputes (`worker/vault.ts`, `worker/chat.ts`, `worker/disputes.ts`):**
  - Vault: `POST /api/vault/details`, `POST /api/vault/bind-ad`, `POST /api/vault/bind-order`, `POST /api/vault/payer` (capped at 5 per order), `GET /api/orders/:id/vault`.
  - Evidence: `POST /api/orders/:id/evidence` (<= 1 MB encrypted binary, buyer/seller only, 90d retention) and `GET /api/orders/:id/evidence/:blobId`.
  - Chat: `POST/GET /api/orders/:id/chat` (encrypted offchain, 30 msg/min write limit, 60 req/min read limit, 4 KB max plaintext, `after=` cursor pagination, verified `evidenceBlobId` ownership).
  - Disputes: `POST/GET /api/orders/:id/disputes` (buyer/seller only when order is `PAID` or `DISPUTED`, notifying counterparty + arbiter) and `GET /api/admin/disputes` (7-day backup arbiter filter per row). Arbiter reads of vault/chat/evidence are restricted to `DISPUTED`, filed, or `PAID >= 15m` orders and recorded in `audit_log`.
- **Cron & Chain Scanner (`worker/cron.ts`):** Runs every minute (`* * * * *`) — processes `onchain_jobs`, scans `P2PEscrow` logs from `chain_cursor` (`OrderOpened`, `OrderPaid`, `OrderReleased`, `OrderDisputed`) into `notifications_outbox`, sends outbox emails, sweeps expired rows independently per table using each table's real primary key, checks KYC expiry, and records short non-PII status codes in `cron_health` (visible in `/admin` via `GET /api/admin/health`).

## Run it

```
npm install
npm run dev            # Vite on :5173 (proxies /api -> :8787)
npm run worker:dev     # Cloudflare Worker on :8787 (reads .dev.vars)
npm run check          # oxlint + tsc --noEmit (cross-platform)
npm run worker:test    # Vitest Worker test suite
```
Restart `wrangler dev` after editing `.dev.vars`. Use a separate dev Postgres database for local development (never point local dev at production).

Environment variables (names only):
- Public Vite / `wrangler.jsonc` vars: `VITE_P2P_ESCROW_ADDRESS`, `VITE_P2P_DEPLOY_BLOCK`, `VITE_ARC_TESTNET_EURC_ADDRESS`, `DIDIT_MODE`, `PUBLIC_APP_URL`.
- Worker secrets (`.dev.vars` locally, `wrangler secret put` in production — never in `wrangler.jsonc`): `SESSION_SECRET`, `VAULT_MASTER_KEY`, `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`, `VERIFIER_PRIVATE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, and optional AI keys (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `CUSTOM_AI_API_KEY`).

## App shell (`src/main.tsx`, `src/App.tsx`)

- `main.tsx`: Wagmi + React Query + ConnectKit + `ThemeProvider` (`src/lib/theme.tsx`) + Sonner toaster. `src/config.ts` holds the wagmi chains (Arc Testnet plus the bridge source testnets).
- `App.tsx`: `AgentProvider` (one assistant conversation for the whole app) > `Backdrop` + `ScrollProgress` + the current page (chosen by `useRoute()` from `src/lib/router.ts`, a tiny pushState router, no react-router) + `Footer` + floating `AgentChat`. The page wrapper only does a CSS fade (`.page-in`); there is deliberately no AnimatePresence route transition, it caused blank pages.
- Pages are statically imported and wrapped in `ErrorBoundary`.
- Shared context objects (`AgentContext`, theme) are stored on `globalThis` so a hot-reload duplicate module cannot create a second context and crash with "must be used inside Provider".
- Use `src/onchain-facts.ts`, `src/onchain-money.ts`, `src/onchain-wait.ts` for chain facts, USDC amount math and tx state. Do not hardcode addresses or decimals.

## P2P

### Contract (`contracts/P2PEscrow.sol`, OpenZeppelin v5, v2.1)
Holds USDC only. Flat per-ad listing fee (`listingFee`, default `0.05 USDC`, owner-configurable up to `0.50 USDC`; refreshes, orders, disputes and chat are free; 0% trade fee), not upgradeable. Roles: **owner** (pause, set listing fee & `feeRecipient`, set `verifier` & `kycRequired`, set primary/backup arbiter, currency allowlist, Phase 2 privacy switches; `renounceOwnership` is disabled), **verifier** (sets/revokes onchain KYC level + expiry only; can never move funds), **arbiter** (takes cases & rules on disputes from Paid >= 15m or Disputed, can restrict accounts or waive dispute limits), and **backupArbiter** (can act once 7 days have passed since `disputedAt` or `paidAt`).

Ad: `maker, side (Sell=0|Buy=1), currency (bytes3), paused, closed, createdAt, paymentMask, windowMinutes, priceE6, min/max/available/initialAmount (USDC 6dp), details, minTakerCompleted, merchantAd, expiresAt, detailsMode (0=plain|1=handshake|2=autoReveal), detailsHash`.
Order status: `None, Pending, Paid, Completed, Cancelled, Disputed, ResolvedToBuyer, ResolvedToSeller, Settled`.

Flow:
1. `createAd` (13 args, `ttlHours` 1..168, `refreshAd` extends expiry for free): pulls `listingFee` (accrued in `feesAccrued`, non-refundable on close/expiry, claimable to `feeRecipient` by anyone via blocklist-safe `collectFees()`); Sell ads also pull `totalAmount` USDC into escrow (`totalAmount + listingFee`); Buy ads require `isMerchant` or >= 3 completed trades plus `listingFee` in wallet.
2. `openOrder(adId, amount, limitPriceE6, detailsHash, paymentDetails)`: rejects expired ads (`AdExpired`), enforces `kycRequired` on both taker and `ad.maker` (`NotVerified`), enforces taker `orderCap(taker)` (`AboveCap`, with +1 tier uplift for Level-2 KYC), snapshots `bond = min(5e6, max(2e6, 5%))`, and checks `limitPriceE6` (`PriceMoved`). For Sell ads: `detailsMode == 0` (plain) or `2` (`autoReveal`) sets `detailsReady = true` and starts the payment timer immediately; `detailsMode == 1` (`handshake`) starts a 10-minute `revealDeadline` until `shareDetails(orderId, detailsHash)`.
3. `markPaid(orderId, payerProof)` (buyer, inside `deadline + 5 min GRACE`, flagging `paidLate` if after `deadline`; late marks always require `payerProof != 0` and are capped at 2 per rolling 30 days -> `LateMarkLimit`; the UI never shows the grace window as extra time, turning red at `00:00` to prompt for the transfer ID) -> `release` (seller, from Pending or Paid -> Completed; from Disputed -> Settled).
4. `cancelOrder`: Pending: buyer any time, anyone else after `deadline + GRACE` (or `revealDeadline` when handshake details never arrived; no strike on buyer if seller never revealed). Disputed: buyer can cancel to settle (`Settled`, USDC to seller). Settling while Disputed (seller `release` or buyer `cancelOrder`) never charges a bond and earns no completion credit/volume: if `reviewStartedAt == 0` within `COOLING_OFF = 30 min` of `disputedAt`, clean settlement (0 strike, 0 concession); if `reviewStartedAt == 0` after 30 min, `stats.concessions++` (`2 concessions = 1 lost dispute`); if `reviewStartedAt != 0` (arbiter called `takeCase`), `stats.disputesLost++` with 0 bond.
5. `openDispute` (permissionless fallback, 0 upfront balance; seller any time when Paid, buyer after 15 min), `takeCase(orderId)` (arbiter/backupArbiter sets `Disputed` + `reviewStartedAt`, requiring 15 min from `paidAt` if not yet disputed), and `resolveDispute(orderId, toBuyer, slashLoser, applyBond)` from Paid (>= 15 min) or Disputed. Full escrowed `order.amount` goes to winner; only when `applyBond == true` does the loser owe `order.bond` from free margin (`effectiveMargin`) first, with any shortfall recorded in FIFO `_debts` (`MAX_DEBTS_PER_ACCOUNT = 8`) blocking new ads/orders until repaid via `repayDebt` (or auto-offset in `depositMargin` / `withdrawClaimable`). Optional `slashLoser` takes extra margin up to `order.amount`.
6. `postMessage(orderId, text)` emits plain `OrderMessage` events (280 bytes, emergency fallback). Phase 2 hooks onchain: `verifier` + `setVerification` / `revokeVerification` / `isVerified` + `kycRequired`, `registerEncryptionKey(bytes)` + `encryptionKeysFor(orderId)`, `sealedEnabled` and `payerProofRequired` (switches off until Phase 2 backend is live).

Safety rules: taker open-order cap 5; tiered per-order caps (`0` trades: 200 USDC; `1..4` or Merchant: 500 USDC; `5..19` & age >= 7d: 2,000 USDC; `>= 20` & age >= 14d: uncapped; Level-2 KYC lifts trade tier by +1); ad can require `minTakerCompleted`; 3 buyer-taker Pending cancels/expiries in 24h => 24h cooldown (Buy-ad expiries pause the ad instead of striking the maker); lost-dispute auto-restriction (`disputesLost + concessions / 2 >= limit`, where `limit` is 1 if <3 completed, else 2, waivable via `setDisputeWaiver` and cleared when a new loss threshold is crossed), `setRestricted`, `totalDebt > 0`, or `kycRequired` unverified blocks new ads/orders (exits, settlements, withdrawals and `collectFees` still work); completion stats only count Completed orders >= 10 USDC and once per distinct pair; merchant margin (>= 100 USDC => Merchant badge, 7-day withdrawal delay, blocked while orders are open); `pause()` stops only `createAd`/`openOrder`; failed USDC payouts (blocklist) are credited to `claimable` and pulled with `withdrawClaimable`.
Views used by the UI: `getAds(offset,limit)`, `getOrders`, `getOrder`, `getAccount`, `getDebts`, `orderCap`, `computeBond`, `isDisputeLimitReached`, `disputeLimitWaived`, `getUserOrderIds`, `adCount`, `orderCount`, `arbiter`, `backupArbiter`, `owner`, `verifier`, `verification`, `isVerified`, `kycRequired`, `listingFee`, `feeRecipient`, `feesAccrued`, `paused`, `sealedEnabled`, `payerProofRequired`, `claimable`.

Tests: `contracts/test/P2PEscrow.*.t.sol` (unit, fuzz, invariants; mock USDC with a block list). Deployed copy on Arc Testnet: **v2.1** `0xf719ebbc5080aee09e38909764b897e0bf01a9b0` at block `72902228` (deprecated: v2.0 `0x22f28c481f2842c5a68028944a4f3fa7ebdf58de` at block `72788405`, v1 `0x271b519275380f60fa100d0cff101800893a8fa0`); metadata in `contracts/contract-metadata/P2PEscrow.json`. After changing the contract: `forge build`, regenerate `src/abi/p2pEscrow.ts` (`as const` ABI), redeploy, update the two `VITE_P2P_*` variables, restart Vite.

### Frontend map
- Reads: `src/hooks/useEscrow.ts` (`useAds`, `useOrders`, `useOrder`, `useAccounts`, balances, `useOrderMessages` via `getLogs` from the deploy block). The lists read the newest 200 ads/orders directly; no indexer.
- Writes: `src/hooks/useTx.ts` `run(key, label, send)` switches to Arc, sends, waits for the receipt, toasts, invalidates queries. USDC `approve` is sent before `createAd` (sell), `openOrder` (buy ad) and `depositMargin`.
- Constants, currencies, payment methods (bit index = mask bit), status labels, formatters: `src/lib/p2p.ts`. Logos and flags: `src/components/logos.tsx` (files in `public/logos`, `public/flags`; missing brands use a monogram tile).
- UI: `pages/P2P.tsx` (tabs, deep links `?order=ID`, `?trade=adId&amount=`), `Market.tsx` + `MarketHero.tsx` + `AdCard.tsx` (browse and filter), `TradeSheet.tsx` (open an order), `OrderRoom.tsx` (timer, steps, actions, release confirmation, `OrderChat.tsx`), `PostAdSheet.tsx`, `Lists.tsx` (My orders, My ads), `AccountPanel.tsx` (trust + margin), `hooks/useEligibility.ts` (paused, restricted, cooldown banners).
- Payment details and messages are public onchain by design (known limitation).

## Swap and Bridge (Circle App Kit)

- `src/lib/appkit.ts` exports one `AppKit` instance and error helpers. Wallet: wagmi connector -> `createViemAdapterFromProvider` (`@circle-fin/adapter-viem-v2`), switching to the right chain first.
- **Swap**: Arc Testnet only, USDC and EURC enabled. Flow = `estimateSwap` (review) -> user confirms -> `swap`. The quote is tied to the connected account and inputs; any change invalidates it. Slippage options 0.5/1/3%.
- **Bridge**: `Arc_Testnet, Ethereum_Sepolia, Base_Sepolia, Arbitrum_Sepolia, Optimism_Sepolia, Avalanche_Fuji, Polygon_Amoy_Testnet`. `estimateBridge` -> `bridge` with `useForwarder: true` (Circle mints on the destination, no destination gas). Step list comes from real `bridge.*` events; `retryBridge` resumes failed transfers.
- Both are implemented twice on purpose: as full pages (`pages/Swap.tsx`, `pages/Bridge.tsx`) and as reusable state machines (`hooks/useSwapFlow.ts`, `hooks/useBridgeFlow.ts`) used by the chat cards (`components/chat/SwapCard.tsx`, `BridgeCard.tsx`). Keep behaviour in sync if you change one.

## Assistant

Browser talks only to `/api/*` (Vite proxy to `server/index.ts`, a plain Node `http` server run with Bun). No AI key ever reaches the browser.

Server:
- `server/index.ts`: `GET /health` (provider status, no secrets), `POST /chat`. Validates the message list (only `user|assistant|tool` roles, size and count caps), prepends the system prompt, sends the tool schema, rate-limits per IP, and forwards to an OpenAI-compatible `/chat/completions` endpoint. OpenRouter, Groq, Gemini (its OpenAI-compat URL) and a custom base URL all go through the same code. A DNS fallback via DoH exists for sandboxes where normal DNS fails.
- `server/agent.ts`: system prompt and the tool definitions (read tools: `search_p2p_ads`, `get_wallet_summary`, `get_my_orders`; proposal tools: `propose_swap`, `propose_bridge`, `propose_p2p_trade`, `open_order`).
- `server/settings.ts` + `server/admin.ts`: saved provider overrides in `server/ai-settings.json` (gitignored, mode 600), and the admin API (below). Saved settings win over env vars.

Client (`src/agent/*`):
- `tools.ts` executes tools **in the browser**: read tools query the contract with viem; propose tools validate arguments (amount regex, chain allow-list, ad exists and is live, amount within limits) and return a `Proposal` (card data + deep link). Ad notes, payment details and order messages are never sent to the model (prompt-injection hygiene).
- `useAgent.ts` runs the loop: send history -> run returned tool calls -> repeat (max 6). After a successful propose tool the client writes the follow-up line itself instead of asking the model again. `textCalls.ts` rescues small models that print `propose_swap(...)` as text instead of using the tool interface.
- `AgentContext.tsx` makes one conversation shared by `components/AgentChat.tsx` (floating panel, hidden on `/assistant`) and `pages/Assistant.tsx`. `components/chat/ChatThread.tsx` renders messages and proposal cards; cards offer "do it here in chat" (SwapCard/BridgeCard) or "open the page" (prefilled by query params).
- Hard rule: the assistant never signs or sends anything. Every money move needs an explicit confirm and wallet signature in the UI.

## Admin (`/admin`)

Visible for the contract `owner`, `arbiter`, or `backupArbiter` (`hooks/useAdmin.ts` reads all three). Tabs: Overview (includes settled disputes, accrued fees, feeRecipient, verifier, and backup arbiter), Disputes (`DisputeCard` + Paid/Disputed lookup: `Take case` button, `reviewStartedAt` status, parties' records & concessions, bond & late-mark indicators, fallback evidence thread, primary/7-day backup arbiter ruling with per-case `applyBond` + optional extra margin slash), Accounts (lookup, tiers, KYC status & revoke, concessions, late marks, caps, debts, dispute waivers, restrict, watchlist), Controls (owner: pause, listing fee & recipient, `collectFees`, KYC verifier & `kycRequired`, primary/backup arbiter, Phase 2 privacy switches, currency allowlist) and AI provider (`AiProviderTab`).
AI provider API (`server/admin.ts`): the admin signs a message (`GET /admin/nonce`, `POST /admin/login`), the server verifies the signature and checks the address against the contract owner/arbiter, then issues a 30-minute in-memory bearer token. Endpoints under `/admin/ai` list status, save (key, model, base URL), test a provider and clear it. Keys are write-only; they are never returned.

## Look and feel

- Tokens in `src/index.css`: dark and light themes through CSS variables (`data-theme`, system option, no-flash script in `index.html`). `.stage` forces the dark tokens inside the hero and footer scene. Fonts: Fredoka (display), DM Sans, Pacifico (logo script).
- Effects in `src/components/fx/` (Backdrop, Reveal, RollingNumber, TiltCard, SpotlightCard, CursorGlow, ScrollProgress, RouteVisual) respect `prefers-reduced-motion`.
- Landing page: `pages/Home.tsx` + `components/home/*`. The hero and the footer scene (`components/FooterCta.tsx`) use `BackgroundSlot`, which shows a placeholder until `public/hero/hero-bg.*` and `public/hero/footer-bg.*` exist.

## Gotchas

- After a long edit session an open browser tab can mix old and new modules and show blank pages or "Invalid hook call"; hard-refresh first.
- Vite dev needs `server.allowedHosts: true` and the `/api` proxy in `vite.config.ts`. Heavy SDKs (`@circle-fin/app-kit`) are in `optimizeDeps.include` to avoid mid-session re-bundling reloads.
- The platform deployer wallet is shared; the contract owner/arbiter on the current deployment is the project owner's own wallet (see `AGENTS.md`).
- Testnet only. Local fiat payments cannot be verified onchain; the arbiter decides disputes on evidence.

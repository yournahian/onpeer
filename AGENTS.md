# OnPeer

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

OnPeer is a P2P USDC marketplace for South Asian currencies on Arc Testnet (escrow contract `contracts/P2PEscrow.sol`), plus Swap and Bridge pages, a chat assistant, a light/dark/system theme, and an owner/arbiter admin panel at `/admin`. Routes: `/`, `/p2p`, `/swap`, `/bridge`, `/admin`.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```

## Phase 2 Backend (Cloudflare Worker)

All `/api/*` routes are now handled by the **Cloudflare Worker** (`worker/`), not the legacy Bun server.

### Architecture

- **Worker:** `worker/index.ts` — routes all `/api/*` requests; runs on Cloudflare Workers runtime
- **Database:** Supabase Postgres (project `ussxdsjqniaavplievhj`, role `onpeer_worker`) accessed via **Hyperdrive** (binding `HYPERDRIVE`, ID `29784572f5b142fbaec583da0f7d131f`)
- **Legacy server:** `server/index.ts` — `@deprecated LEGACY`, no longer wired to Vite proxy; kept for standalone fallback testing only. Do not add new features here.
- **Cron:** `scheduled()` runs every minute (`*/1 * * * *`) — fires `runAllCronJobs` + `processNotificationsOutbox`

### Key Worker Files

| File | Purpose |
|------|---------|
| `worker/auth.ts` | Wallet-sig session auth — `getSession`, `requireSession` |
| `worker/chain.ts` | On-chain reads — `checkOrderAccess`, `checkAdminAccess`, `ChainOrder`, `ChainRoles` |
| `worker/crypto.ts` | AES-256-GCM envelope — `sealText`/`openText`, `sealBlob`/`openBlob`, HMAC, keccak256 |
| `worker/accounts.ts` | Wallet accounts, email opt-in, unsubscribe — `mintUnsubscribeUrl` |
| `worker/kyc.ts` | Didit KYC — start/status/webhook, HMAC verification, name fuzzy match |
| `worker/vault.ts` | Encrypted payment details & order vault — bind-ad, payer reveal |
| `worker/chat.ts` | Encrypted per-order chat messages |
| `worker/disputes.ts` | Offchain dispute filings + admin queue |
| `worker/notify.ts` | Resend email notifications — `queueNotification`, `processNotificationsOutbox` |
| `worker/cron.ts` | Retention jobs — `sweepExpiredRows`, `sweepExpiredSessions`, `checkKycExpiry` |
| `worker/db.ts` | DB helpers — `writeAudit`, `checkRateLimit` |
| `worker/env.ts` | Env helpers — `json`, `readJsonBody`, `textField` |

### Database Schema (`db/migrations/0001_init.sql`)

Tables: `sessions`, `accounts`, `kyc_sessions`, `audit_log`, `rate_limits`, `webhook_events`, `onchain_jobs`, `notifications_outbox`, `vault_blobs`, `chat_messages`, `dispute_filings`.

### Secrets

Stored in `.dev.vars` (local) and Cloudflare Secrets (production):

| Secret | Purpose |
|--------|---------|
| `SESSION_SECRET` | HMAC key for session tokens |
| `VAULT_MASTER_KEY` | AES-256-GCM master key for vault/chat/dispute encryption |
| `DIDIT_API_KEY` | Didit KYC API key |
| `DIDIT_WORKFLOW_ID` | Didit workflow ID |
| `DIDIT_WEBHOOK_SECRET` | Auto-registered HMAC webhook secret (43 chars) |
| `DIDIT_MODE` | `sandbox` or `production` |
| `VERIFIER_PRIVATE_KEY` | Private key for `verifier` role wallet (`0xeebd29441AF1a931C4a6eEc2265B0757fd992f5e`) |
| `RESEND_API_KEY` | Resend transactional email API key |
| `EMAIL_FROM` | Sender identity — `OnPeer <noreply@onpeer.xyz>` (domain verified in Resend) |

### Local Development

```powershell
# Worker (proxied by Vite at /api)
npx wrangler dev --port 8787

# Frontend (in separate terminal)
bun run dev
```

### Testing & Linting

```powershell
npx vitest run          # 9 test files, 60 tests
npx oxlint src worker server   # 0 warnings, 0 errors
```

### Phase 2 Feature Flags

| Flag | State | Notes |
|------|-------|-------|
| `sealedEnabled` | **OFF** | Enable via `/admin` → Controls after backend deployed to production |
| `payerProofRequired` | **OFF** | Enable via `/admin` → Controls after `sealedEnabled` is live |
| `kycRequired` | **OFF** | Stays off until legal review complete |

### KYC Webhook

- **Production:** `https://app.onpeer.xyz/api/kyc/webhook`
- **Local testing:** cloudflared tunnel → `http://localhost:8787/api/kyc/webhook`

### Verifier Wallet

- Address: `0xeebd29441AF1a931C4a6eEc2265B0757fd992f5e`
- Role: `verifier` on the P2PEscrow contract
- Private key stored in `VERIFIER_PRIVATE_KEY` secret (never logged)

## Deployed contracts

- P2PEscrow v2.2 (Arc Testnet — USDC): `0x1929e33D2866d06E547eb02A1DDFcAc6bA2304fE` (deployed at block 74214615, tx `0x57ddf74b814166af13899cf032f5fd3f2b70302fb6e8a268d25e775e25346034`).
- P2PEscrow v2.2 (Arc Testnet — EURC): `0xDf8dC07030A0e578d475CA9582F2E87b29EeBa3d` (deployed at block 74214619, tx `0x9272dc1731f13924989bd1cdb14733e80745b5cada26f4bf9061a692cba42382`). Owner, primary arbiter, initial backup arbiter and feeRecipient: `0x54190a788EEf66d9AbddcF7d135B09B4D2b72F3A`. Verifier: `0xeebd29441AF1a931C4a6eEc2265B0757fd992f5e`. The app reads `VITE_P2P_ESCROW_ADDRESS`, `VITE_P2P_DEPLOY_BLOCK`, `VITE_P2P_EURC_ESCROW_ADDRESS`, and `VITE_P2P_EURC_DEPLOY_BLOCK` from `.env`.
- Superseded v2.1: USDC `0xf719ebbc5080aee09e38909764b897e0bf01a9b0` (block 72902228), EURC `0x0db2fbf8357617172a3b852bc2ac3054dba1d402` (block 73721819).
- Deprecated / superseded: 0x22f28c481f2842c5a68028944a4f3fa7ebdf58de (v2.0, block 72788405, deprecated), 0x271b519275380f60fa100d0cff101800893a8fa0 (v1, block 72230487, deprecated), 0xb257939153215ae7eb5a02057877b1ae5f5b04e5 (earlier version, unused).
- Decisions (v2.1): flat 0.05 USDC per-ad listing fee (`listingFee`, max 0.50 USDC, accrued in `feesAccrued` and claimable to `feeRecipient` via `collectFees()`; refreshes, trades, disputes and chat have 0 platform fee). 5-minute late payment recovery window after `deadline` (`paidLate`, never shown as extra countdown time in UI; requires a transfer ID hashed into `payerProof != 0`, max 2 late marks per 30 days). Offchain dispute filing + fallback `openDispute` + arbiter `takeCase` (`reviewStartedAt`) and `resolveDispute(orderId, toBuyer, slashLoser, applyBond)` from `Paid` (after 15m) or `Disputed` (`backupArbiter` after 7 days); bond (`min(5 USDC, max(2 USDC, 5%))`, 0 upfront balance) is charged only when `applyBond == true` from free margin first or FIFO debt. Settling while Disputed (seller `release` or buyer `cancelOrder`) never charges a bond: <=30m cooling-off before `takeCase` is clean, >30m before `takeCase` adds `concessions++` (`2 = 1 lost dispute`), and after `takeCase` adds `disputesLost++`. Trust and safety: `verifier` role + `kycRequired` switch (off until Phase 2; Level-2 KYC lifts tier by +1), `detailsMode` `0/1/2` (`plain`, `handshake`, `autoReveal`), Buy-ad gate (Merchant or 3+ completed trades), ad TTL (1–168h) with free `refreshAd`, tiered caps (200 / 500 / 2,000 / uncapped), auto lost-dispute restriction (`disputesLost + concessions / 2`, waivable via `setDisputeWaiver`), cancel strikes with 24h cooldown, optional merchant margin (100+ USDC, 7-day withdrawal delay, extra arbiter slash), owner pause for new ads/orders only. `kycRequired`, `sealedEnabled` and `payerProofRequired` remain off until Phase 2 backend is deployed.

## Assistant

- Backend: `server/index.ts` (run with `bun run server`, port 3001, proxied by Vite at `/api`). Holds provider keys, owns the system prompt and tool list (`server/agent.ts`). Providers: OpenRouter, Groq, Gemini, custom (OpenAI-compatible).
- Tools run in the browser (`src/agent/tools.ts`). Read tools query the chain; `propose_*` tools only produce a card that deep-links to /swap, /bridge or /p2p with a prefill. The user always reviews and signs on those pages.
- Ad notes, payment details and messages are never passed to the model (prompt-injection hygiene).
- Server falls back to DNS-over-HTTPS when the system resolver cannot resolve a provider host (needed for fresh *.trycloudflare.com tunnels in the sandbox).
- Swap and bridge cards can run fully in chat via `src/hooks/useSwapFlow.ts` and `src/hooks/useBridgeFlow.ts` (quote, explicit confirm, live progress, retry). The chat panel stays mounted when closed so in-progress transfers are not lost. The manual /swap and /bridge pages keep their own logic.

# OnPeer

A peer-to-peer marketplace for trading USDC against local currencies (INR, PKR, BDT, LKR, NPR, BTN, MVR, AFN) on Arc Testnet. USDC is held in escrow until the seller releases it, and a designated arbiter settles disputes.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Chat assistant (floating button, plus a full page at /assistant that shares the same conversation) that finds P2P ads, checks balances and orders, and prepares P2P orders for you to review, and can run a whole swap or bridge inside the chat (quote, confirm, progress, retry) or hand you to the manual page. You always confirm and sign yourself
- Landing page with an animated hero, three entry points (P2P, Swap, Bridge), a how-it-works walkthrough, FAQ and footer
- Light, dark and system themes, switchable from any page
- Admin panel at /admin for the owner, arbiter and 7-day backup arbiter: offchain/onchain dispute queue with "Take case" and 4-arg rulings (`applyBond` + `slashLoser`), settled-dispute tracking, account lookup with tiers, KYC status, concessions, late marks, unpaid bond debts, restrictions and dispute waivers, pause switch, listing fee & accrued-fee collection, KYC verifier & `kycRequired` switch, primary/backup arbiter, Phase 2 privacy switches, currency controls, and an AI provider tab (choose OpenRouter, Groq, Gemini or a custom OpenAI-compatible endpoint, save its key on the server, test the connection). The tab is unlocked by signing a free message with the owner or arbiter wallet.
- Swap USDC and EURC on Arc Testnet with a quote and fee preview
- Bridge USDC between Arc and Ethereum, Base, Arbitrum, Optimism, Avalanche and Polygon testnets
- Buy USDC sandbox page at `/buy` powered by Circle App Kit Onramp (`@circle-fin/app-kit` + `@circle-fin/app-kit/server`, sandbox dummy data only, server-locked wallet destination)
- Direct cash-out deep-links (`/p2p?mode=sell`) into the P2P Sell USDC marketplace

- Buy and sell USDC with country and payment-method filters (UPI, bKash, Raast, eSewa and more); 0% per-trade fee with a flat 0.05 USDC per-ad listing fee
- Post buy or sell ads with your own price, limits, payment window and expiry (1–168 hours, refreshable for free anytime; Buy ads require a Merchant badge or 3+ completed trades plus the 0.05 USDC listing fee)
- Order room with a payment countdown (turns red on expiry so a buyer who already paid can submit their transfer ID), mark-as-paid, release, 30-minute dispute cooling-off / concession settlement, and dispute escalation
- Trust and safety: tiered per-order caps (200 / 500 / 2,000 USDC / uncapped by completed trades, account age, and Level-2 KYC uplift), optional KYC gating (`kycRequired`), arbiter-chosen loser-pays dispute bond (2–5 USDC from free margin or recorded debt, 0 upfront wallet balance required), cancellation strikes and cooldowns, restricted accounts, per-ad minimum-trades requirement, optional merchant security margin, fallback in-order messages
- Primary arbiter and 7-day backup arbiter view for taking cases and resolving disputes from Paid (after 15m) or Disputed, with per-ruling bond choice and optional extra margin slashing

## Tech stack

React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, Circle App Kit, Solidity (Foundry, OpenZeppelin)

## Development

Prerequisites: [Bun](https://bun.sh), [Foundry](https://getfoundry.sh), and [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

```bash
bun install
bun run dev              # Vite frontend on :5173
npx wrangler dev --port 8787  # Cloudflare Worker (API + AI chat) on :8787, proxied by Vite
bun run check            # lint and typecheck
bun run contracts:build
bun run contracts:test
```

> **Legacy:** `bun run server` starts the old Bun assistant backend (`server/`). It is no longer
> wired to the Vite proxy. The Cloudflare Worker (`worker/index.ts`) now handles all `/api/*`
> routes including the AI chat endpoint.

### Worker secrets (local)

Copy `.env.example` → `.dev.vars` and fill in the Worker secrets. The file is gitignored.
See `.env.example` for a full description of every variable.

**Required for Phase 2 & Phase 3 features:**
- `SESSION_SECRET` — 64 hex chars (`openssl rand -hex 32`)
- `VAULT_MASTER_KEY` — 64 hex chars (`openssl rand -hex 32`)
- `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID` — from [didit.me](https://didit.me)
- `VERIFIER_PRIVATE_KEY` — separate relayer wallet (not owner/arbiter)
- `RESEND_API_KEY`, `EMAIL_FROM` — from [resend.com](https://resend.com)
- `CIRCLE_API_KEY` — Circle Testnet Onramp API key (`TEST_API_KEY:...`, sandbox only) paired with `ONRAMP_API_BASE_URL`, `ONRAMP_WIDGET_BASE_URL`, `VITE_ONRAMP_WIDGET_BASE_URL`, and `ONRAMP_REFERRER_DOMAIN`

### Deployed contracts (Arc Testnet)

- **P2PEscrow v2.1 (active):** `0xf719ebbc5080aee09e38909764b897e0bf01a9b0` (block `72902228`)
- **Deprecated:** `0x22f28c481f2842c5a68028944a4f3fa7ebdf58de` (v2.0, block `72788405`), `0x271b519275380f60fa100d0cff101800893a8fa0` (v1, block `72230487`)

### Environment variables

- `VITE_P2P_ESCROW_ADDRESS`: address of the deployed escrow contract on Arc Testnet (public).
- `AI_PROVIDER`: optional. `openrouter`, `groq`, `gemini` or `custom`. Defaults to the first provider that has a key. Server only.
- `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`: key for the provider you use. Server only, never exposed to the browser.
- `OPENROUTER_MODEL`, `GROQ_MODEL`, `GEMINI_MODEL`: optional model overrides.
- `CUSTOM_AI_BASE_URL`, `CUSTOM_AI_API_KEY`, `CUSTOM_AI_MODEL`, `CUSTOM_AI_LABEL`: any OpenAI-compatible endpoint that supports tool calling.
- `AGENT_PORT`: optional, port of the assistant backend (default 3001).
- `VITE_ARC_TESTNET_EURC_ADDRESS`: EURC token address on Arc Testnet, used to show the EURC balance on the swap page (public).
- `VITE_P2P_DEPLOY_BLOCK`: block the contract was deployed at, used to load order messages (public).
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio; optional elsewhere.

## Notes

Fiat payments happen outside the app and payment details are stored onchain, so they are public. Check the rules for crypto trading in your country before using this with real funds.

## Assets

Country flags come from the open-source [flag-icons](https://github.com/lipis/flag-icons) set. Payment brand logos in `public/logos` belong to their owners and are shown only to identify each payment method. To add or replace a logo, drop a file into `public/logos` and map the method name in `src/components/logos.tsx`.

## Hero and footer backgrounds

The hero and the footer scene each have a background slot. Until you add an image they show a labelled placeholder. To use your own picture, put it in `public/hero` as `hero-bg.webp` (or `.jpg` / `.png`, about 1920 x 1080) for the hero and `footer-bg.webp` (about 1920 x 900) for the footer.

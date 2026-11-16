# OnPeer

A peer-to-peer marketplace for trading USDC against local currencies (INR, PKR, BDT, LKR, NPR, BTN, MVR, AFN) on Arc Testnet. USDC is held in escrow until the seller releases it, and a designated arbiter settles disputes.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Chat assistant (floating button, plus a full page at /assistant that shares the same conversation) that finds P2P ads, checks balances and orders, and prepares P2P orders for you to review, and can run a whole swap or bridge inside the chat (quote, confirm, progress, retry) or hand you to the manual page. You always confirm and sign yourself
- Landing page with an animated hero, three entry points (P2P, Swap, Bridge), a how-it-works walkthrough, FAQ and footer
- Light, dark and system themes, switchable from any page
- Admin panel at /admin for the owner and arbiter: dispute queue with evidence and rulings, account lookup and restrictions, pause switch, arbiter and currency controls, and an AI provider tab (choose OpenRouter, Groq, Gemini or a custom OpenAI-compatible endpoint, save its key on the server, test the connection). The tab is unlocked by signing a free message with the owner or arbiter wallet.
- Swap USDC and EURC on Arc Testnet with a quote and fee preview
- Bridge USDC between Arc and Ethereum, Base, Arbitrum, Optimism, Avalanche and Polygon testnets

- Buy and sell USDC with country and payment-method filters (UPI, bKash, Raast, eSewa and more)
- Post buy or sell ads with your own price, limits and payment window
- Order room with a payment countdown, mark-as-paid, release and dispute
- Trust and safety: cancellation strikes and cooldowns, restricted accounts, per-ad minimum-trades requirement, caps for brand-new accounts, optional merchant security margin, in-order messages for evidence
- Arbiter view for resolving disputes, with optional margin slashing

## Tech stack

React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, Circle App Kit, Solidity (Foundry, OpenZeppelin)

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
bun run dev        # start the app
bun run server     # start the assistant backend (needs an AI provider key)
bun run check      # lint and typecheck
bun run contracts:build
bun run contracts:test
```

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

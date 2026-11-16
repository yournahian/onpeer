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

## Deployed contracts

- P2PEscrow (Arc Testnet): 0x271b519275380f60fa100d0cff101800893a8fa0 (deployed at block 72230487). Owner and arbiter: 0x54190a788EEf66d9AbddcF7d135B09B4D2b72F3A. The app reads `VITE_P2P_ESCROW_ADDRESS` and `VITE_P2P_DEPLOY_BLOCK` from `.env`.
- Superseded: 0xb257939153215ae7eb5a02057877b1ae5f5b04e5 (earlier version, unused).
- Decisions: no fees. Disputes settle only through the arbiter (the owner can replace it); no automatic split, and the seller cannot release once a dispute is open. Trust and safety: cancel strikes with 24h cooldown, restricted accounts, minimum-trades requirement per ad, 200 USDC cap for new takers, optional merchant margin with 7-day withdrawal delay and arbiter slashing, onchain order messages, owner pause for new ads and orders only. Payment details and messages are public onchain.

## Assistant

- Backend: `server/index.ts` (run with `bun run server`, port 3001, proxied by Vite at `/api`). Holds provider keys, owns the system prompt and tool list (`server/agent.ts`). Providers: OpenRouter, Groq, Gemini, custom (OpenAI-compatible).
- Tools run in the browser (`src/agent/tools.ts`). Read tools query the chain; `propose_*` tools only produce a card that deep-links to /swap, /bridge or /p2p with a prefill. The user always reviews and signs on those pages.
- Ad notes, payment details and messages are never passed to the model (prompt-injection hygiene).
- Server falls back to DNS-over-HTTPS when the system resolver cannot resolve a provider host (needed for fresh *.trycloudflare.com tunnels in the sandbox).
- Swap and bridge cards can run fully in chat via `src/hooks/useSwapFlow.ts` and `src/hooks/useBridgeFlow.ts` (quote, explicit confirm, live progress, retry). The chat panel stays mounted when closed so in-progress transfers are not lost. The manual /swap and /bridge pages keep their own logic.

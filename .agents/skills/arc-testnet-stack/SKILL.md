---
name: arc-testnet-stack
description: Working rules for building on Arc (Circle's L1 where USDC is the gas token) with Circle's developer products. Use for any contract, wallet, swap, bridge, on-ramp or backend task in this repo. Testnet only by default.
---

# Arc and Circle stack rules

Read first: https://docs.arc.io/llms.txt and https://developers.circle.com/llms.txt. Confirm facts there before relying on this file, because this file can go stale.

## Defaults
- **Arc Testnet and USDC only.** Never deploy to or send real value on a mainnet unless the owner explicitly asks and accepts the risk in writing in the conversation.
- Chain id `5042002` on Arc Testnet. In code use the chain definition from `viem/chains` (`arcTestnet`) and the repo's `src/onchain-facts.ts`, not hardcoded copies.
- USDC is the gas token. A wallet with no USDC cannot send any transaction, even a free-looking one such as "I've paid".
- The USDC ERC-20 interface on Arc is at `0x3600000000000000000000000000000000000000` and has 6 decimals. Never use `msg.value` for token amounts. Use `src/onchain-money.ts` helpers for parsing and formatting.
- EURC address comes from environment (`VITE_ARC_TESTNET_EURC_ADDRESS`). Do not inline it.

## Circle products and when to use each
| Need | Use |
|---|---|
| Swap tokens on Arc | `@circle-fin/app-kit` swap (supported tokens vary, check the docs) |
| Move USDC across chains | App Kit bridge (CCTP), Forwarding Service so the user needs no gas on the destination |
| Buy USDC with fiat | Onramp via App Kit `kit.onramp` (see the `circle-onramp` skill) |
| Chain-abstracted USDC balance | Gateway or the unified balance kit |
| Wallets | Circle developer-controlled, user-controlled or modular (passkey, gas sponsored) wallets, only if the product needs them |
| Contract deploy and event webhooks | Circle Smart Contract Platform, optional |
| Sell USDC for fiat | No end-user off-ramp widget exists. Circle Mint is for institutions only. See the Phase 3 prompt before building anything |

## Habits
- Check package versions with `npm view <pkg> version` before installing. Never guess an API name. Read the docs page, then code.
- All secrets live in server environment (Worker secrets, `.dev.vars` locally). Never in `VITE_*`, never in git, never printed in logs or chat. If a secret is pasted into chat, say so and ask for rotation.
- Money-moving actions are signed by the user's wallet. Backend code and the AI assistant never sign.
- USDC can be blocklisted. Payout code must not let one failing recipient block other users (credit a claimable balance and let them withdraw).
- Prove it: lint, typecheck, tests, and for onchain work a transaction hash plus a read-back. Say "not run" for anything not run.
- Keep diffs small. List the files you will change before editing.

## Repo conventions
Read `AGENTS.md` and `docs/ARCHITECTURE.md`. Production API is the Cloudflare Worker in `worker/`. The database is Supabase Postgres reached through Hyperdrive. The legacy Bun `server/` is not used by the proxy.

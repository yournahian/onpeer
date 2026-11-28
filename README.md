<div align="center">

# OnPeer

**Non-Custodial P2P Stablecoin Marketplace & Cross-Chain Liquidity Hub on Arc**

[![Network: Arc Mainnet](https://img.shields.io/badge/Network-Arc%20Mainnet%20(5042)-FF5A00?style=flat-square)](https://arc.etherscan.io)
[![Contracts: Verified](https://img.shields.io/badge/ArcScan-Exact%20Match%20Verified-10B981?style=flat-square)](https://arc.etherscan.io/address/0xC073b1A5ac4004fD82cAc6BDA5548FFc5E5cB97e#code)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?style=flat-square)](contracts/P2PEscrow.sol)
[![P2P Trade Fee](https://img.shields.io/badge/P2P%20Trade%20Fee-0%25-2563EB?style=flat-square)](https://app.onpeer.xyz/p2p)
[![License: MIT](https://img.shields.io/badge/License-MIT-64748B?style=flat-square)](contracts/P2PEscrow.sol)

[Live App](https://app.onpeer.xyz) · [Documentation](https://docs.onpeer.xyz) · [Website](https://onpeer.xyz) · [ArcScan](https://arc.etherscan.io/address/0xC073b1A5ac4004fD82cAc6BDA5548FFc5E5cB97e#code)

</div>

---

## Overview

**OnPeer** is a non-custodial peer-to-peer marketplace for trading **USDC** and **EURC** against 8 South Asian fiat currencies (**BDT, INR, PKR, LKR, NPR, BTN, MVR, AFN**) on **Arc** — Circle's Layer-1 blockchain where USDC is the native gas token with sub-second deterministic finality.

Every P2P order is secured by immutable, verified Solidity smart contracts (`P2PEscrow v2.3`), paired with AES-256-GCM encrypted off-chain order chat & payment vaults, Didit identity verification, instant swaps, cross-chain bridging, and an AI trading assistant.

---

## Core Modules

| Module | Route | Description |
| :--- | :--- | :--- |
| **P2P Marketplace** | `/p2p` | Buy & sell **USDC** and **EURC** with 0% trade fee (flat 0.05 listing fee per ad), tiered limits, merchant margin, encrypted chat, and fair arbitration. |
| **Instant Swap** | `/swap` | On-chain swaps on Arc Mainnet powered by **AchSwap** (0.05% integrator fee) and **Circle App Kit** on Arc Testnet, with live quotes and slippage protection. |
| **Cross-Chain Bridge** | `/bridge` | Native burn-and-mint **USDC** transfers via **Circle CCTP v2** plus **EURC** bridging via **Circle CCTPx** with automated relayer forwarding. |
| **AI Assistant** | `/assistant` | Natural-language P2P ad discovery, wallet summaries, and in-chat swap/bridge execution. Never touches private keys — every transaction requires explicit wallet confirmation. |
| **Documentation** | `/docs` | Full protocol docs, escrow state machine, corridor matrix, and verified contract registry at [docs.onpeer.xyz](https://docs.onpeer.xyz). |
| **Admin Console** | `/admin` | Role-gated console for owner, primary arbiter, and 7-day backup arbiter: dispute rulings, analytics, account lookup, protocol controls, and AI provider settings. |

---

## Verified Smart Contracts

### Arc Mainnet (Chain ID: `5042`) — P2PEscrow v2.3

All mainnet contracts are **open-source (MIT)** and **verified** on **ArcScan (Exact Match)**, **Sourcify**, and **Arc Explorer (Blockscout)**:

| Contract | Address | Block | Explorers |
| :--- | :--- | :--- | :--- |
| **P2PEscrow (USDC)** | `0xC073b1A5ac4004fD82cAc6BDA5548FFc5E5cB97e` | `33297066` | [ArcScan (Exact Match)](https://arc.etherscan.io/address/0xC073b1A5ac4004fD82cAc6BDA5548FFc5E5cB97e#code) · [Arc Explorer](https://explorer.arc.io/address/0xC073b1A5ac4004fD82cAc6BDA5548FFc5E5cB97e?tab=contract) |
| **P2PEscrow (EURC)** | `0xd0dca77625992d3851748B365Ace63803c5d1759` | `33297066` | [ArcScan (Exact Match)](https://arc.etherscan.io/address/0xd0dca77625992d3851748B365Ace63803c5d1759#code) · [Arc Explorer](https://explorer.arc.io/address/0xd0dca77625992d3851748B365Ace63803c5d1759?tab=contract) |
| **P2PEscrowDebtLib** | `0x3a00ccA2AE0dA3E9c45B49A166b60b4527475552` | `33297066` | [ArcScan (Exact Match)](https://arc.etherscan.io/address/0x3a00ccA2AE0dA3E9c45B49A166b60b4527475552#code) · [Arc Explorer](https://explorer.arc.io/address/0x3a00ccA2AE0dA3E9c45B49A166b60b4527475552?tab=contract) |

#### Mainnet Protocol Roles & Tokens

| Role / Asset | Address | Notes |
| :--- | :--- | :--- |
| **USDC (ERC-20 / Native Gas)** | `0x3600000000000000000000000000000000000000` | 6 decimals (ERC-20 interface) |
| **EURC (ERC-20)** | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 decimals |
| **Owner / Fee Recipient** | `0x81eA9AdE2805e310E9f884a75B3a24Ab74557C69` | Cannot sweep escrowed user funds; `renounceOwnership` disabled |
| **Primary & Backup Arbiter** | `0xb213Dc9a65d3d748B6Ec5cCaCCb9b6EC82A40A33` | Resolves disputed orders; 7-day backup fail-safe |
| **KYC Verifier Relayer** | `0x74605c85676E9F514BA33B9B3005e0EE561DAfDd` | Attests Didit KYC status on-chain only (zero fund custody) |

> **Compiler & Verification Note:**
> Compiled with **Solidity `v0.8.28+commit.7893614a`**, `evm_version = "cancun"`, `via_ir = true`, `optimizer_runs = 1`, `bytecode_hash = "none"`, and `cbor_metadata = false` (see [`foundry.toml`](foundry.toml)) to stay within the 24 KB EVM bytecode size limit. Because CBOR metadata is intentionally omitted from the deployed bytecode, **ArcScan** reports **Exact Match**, while Blockscout/Sourcify label all metadata-stripped contracts as *partial match* even though the executable bytecode is 100% byte-for-byte identical.

<details>
<summary><strong>Arc Testnet (Chain ID: 5042002) Deployments</strong></summary>

| Contract | Address | Block |
| :--- | :--- | :--- |
| **P2PEscrow v2.3 (USDC)** | `0x7f661625bC08d72E156A206ee8D24022D7463350` | `74250625` |
| **P2PEscrow v2.3 (EURC)** | `0x26Ef2B69AC928457E348BeEd72Bf116dB81438B9` | `74250630` |

</details>

---

## Supported South Asian Corridors

| Country | Currency | Supported Local Payment Rails |
| :--- | :--- | :--- |
| **Bangladesh** | `BDT` (`৳`) | bKash, Nagad, Rocket, Upay, Bank Transfer |
| **India** | `INR` (`₹`) | UPI, IMPS, NEFT, Paytm, PhonePe, Google Pay, Bank Transfer |
| **Pakistan** | `PKR` (`₨`) | Raast, Easypaisa, JazzCash, SadaPay, NayaPay, Bank Transfer |
| **Sri Lanka** | `LKR` (`Rs`) | LankaQR, FriMi, eZ Cash, Genie, Bank Transfer |
| **Nepal** | `NPR` (`रू`) | eSewa, Khalti, IME Pay, ConnectIPS, Bank Transfer |
| **Bhutan** | `BTN` (`Nu`) | mBoB, mPay, ePay, Bank Transfer |
| **Maldives** | `MVR` (`Rf`) | BML MobilePay, MIB FaisaMobile, Bank Transfer |
| **Afghanistan** | `AFN` (`؋`) | HesabPay, M-Paisa, Bank Transfer |

---

## Security & Trust Architecture

- **Non-Custodial Escrow (`contracts/P2PEscrow.sol`):** Trade funds remain locked in smart contracts until seller release or formal arbitration. Governance cannot withdraw or redirect user escrow. Blocklisted recipients automatically degrade into pull-based `claimable` balances so no order can be bricked.
- **Zero-PII On-Chain & AES-256-GCM Vault (`worker/crypto.ts`):** Bank details, order chat, and dispute evidence are never written to the blockchain. Off-chain payloads are sealed with per-record random 256-bit DEKs, 96-bit IVs, and order-bound AAD, with only `keccak256` commitments anchored on-chain.
- **Fair Disputes & Zero-Upfront-Balance Arbitration:** Opening a dispute requires 0 upfront token balance. Includes a 30-minute cooling-off self-settlement window (0 bond, 0 strikes), concession tracking, loser-pays bonds (2–5 USDC, 5% of order) deducted from free margin or FIFO debt, and a 7-day backup arbiter fail-safe.
- **Progressive Account Tiers & Merchant Margin:** Automated per-order caps (`200` / `500` / `2,000` / `Uncapped`) based on qualifying completed trades and account age, +1 tier boost for Level-2 Didit KYC, Buy-ad eligibility gate (Merchant or 3+ completed trades), and slashable 100+ USDC merchant collateral with a 7-day withdrawal timelock.
- **Wallet-Signature Auth & Prompt-Injection Hygiene:** Gasless EIP-191 sessions (SHA-256 hashed tokens in Supabase Postgres via Cloudflare Hyperdrive with strict RLS). User-authored ad notes, payment details, and chat messages are never passed to the AI Assistant.

---

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, wagmi v2, viem v2, ConnectKit, Sonner
- **Backend:** Cloudflare Workers (`worker/`), Cloudflare Hyperdrive, Supabase Postgres (RLS), Resend, Didit KYC
- **Contracts:** Solidity 0.8.28, Foundry, OpenZeppelin v5 (`contracts/`)
- **Liquidity & Bridging:** AchSwap Developer API (Arc Mainnet Swap), Circle App Kit (`@circle-fin/app-kit`, CCTP v2 & CCTPx)

---

## Local Development

### Prerequisites

- [Bun](https://bun.sh) (or Node.js 20+)
- [Foundry](https://getfoundry.sh) (`forge`, `cast`)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### Commands

```bash
# Install dependencies
bun install

# Start Vite frontend (http://localhost:5173, proxies /api -> :8787)
bun run dev

# Start Cloudflare Worker locally (in a separate terminal)
npx wrangler dev --port 8787

# Lint & typecheck
npx oxlint src worker server
bun run check

# Run Worker tests (Vitest)
npx vitest run

# Build & test Solidity smart contracts
bun run contracts:build
bun run contracts:test
```

### Worker Secrets (Local `.dev.vars`)

Copy `.env.example` to `.dev.vars` (gitignored) and populate your local secrets:

| Secret | Purpose |
| :--- | :--- |
| `SESSION_SECRET` | 64-hex-char HMAC key for EIP-191 session tokens |
| `VAULT_MASTER_KEY` | 64-hex-char AES-256-GCM envelope master key |
| `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` | Didit KYC session & HMAC webhook verification |
| `VERIFIER_PRIVATE_KEY` | Dedicated relayer key for on-chain `setVerification` / `revokeVerification` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email notifications via Resend |
| `ACHSWAP_API_KEY` | AchSwap Developer API key for Arc Mainnet swaps |
| `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` | Optional AI Assistant provider keys (server-only) |

---

## Documentation & Resources

- **Architecture Deep Dive:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **How OnPeer P2P Works:** [`docs/how-p2p-works.md`](docs/how-p2p-works.md)
- **Live Docs Portal:** [docs.onpeer.xyz](https://docs.onpeer.xyz)

---

## Assets & Disclaimer

Country flags are sourced from the open-source [flag-icons](https://github.com/lipis/flag-icons) set. Payment brand logos in `public/logos` belong to their respective owners and are used solely to identify supported payment methods.

> **Disclaimer:** Fiat transfers occur off-chain between peers directly via local payment networks. Always verify settled funds in your own banking or mobile-wallet app and confirm the counterparty's account name before releasing escrowed crypto. Check local regulations regarding digital asset trading in your jurisdiction.

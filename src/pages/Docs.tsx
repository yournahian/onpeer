import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Link2,
  Maximize2,
  Menu,
  MessageSquare,
  Minimize2,
  Search,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import {
  CHAIN_ID,
  COUNTRIES,
  VISIBLE_P2P_ASSETS,
  getEscrowConfig,
  methodsForCountry,
  type P2pAsset,
} from '@/lib/p2p'
import {
  APP_URL,
  DOCS_URL,
  LANDING_URL,
  isDocsSubdomain,
  navigate,
  usePathname,
} from '@/lib/router'
import { LogoMark } from '@/components/Logo'
import { CoinLogo, CountryFlag } from '@/components/logos'
import { ThemeToggle } from '@/components/ThemeToggle'

// ---------------------------------------------------------------------------
// Types & Structured Documentation Content
// ---------------------------------------------------------------------------

type CalloutKind = 'tip' | 'warning' | 'note'

interface CodeSnippet {
  filename: string
  language: string
  code: string
}

interface DocTable {
  headers: string[]
  rows: string[][]
}

interface DocSection {
  id: string
  title: string
  paragraphs: string[]
  bullets?: string[]
  code?: CodeSnippet
  callout?: { kind: CalloutKind; title: string; body: string }
  table?: DocTable
  renderCustom?: 'corridors' | 'contracts'
}

interface DocPageItem {
  slug: string
  title: string
  shortDescription: string
  badge?: string
  category: string
  sections: DocSection[]
}

const DOC_CATEGORIES = [
  'Getting Started',
  'P2P Marketplace',
  'Cross-Chain & Liquidity',
  'Architecture & Reference',
] as const

const DOC_PAGES: DocPageItem[] = [
  {
    slug: 'overview',
    title: 'Platform Overview',
    shortDescription: 'Learn how OnPeer combines non-custodial P2P escrow, instant swaps, and cross-chain bridging on Arc L1.',
    badge: 'Arc L1',
    category: 'Getting Started',
    sections: [
      {
        id: 'what-is-onpeer',
        title: 'What is OnPeer?',
        paragraphs: [
          'OnPeer is a non-custodial peer-to-peer crypto marketplace and cross-chain liquidity hub built for South Asia on Arc (Circle’s Layer-1 blockchain where USDC is the native gas token).',
          'Traders can buy and sell USDC and EURC directly against 8 regional fiat currencies using familiar domestic payment rails such as bKash, Nagad, Rocket, UPI, IMPS, Raast, eSewa, and LankaQR—while every crypto unit remains locked in audited Solidity smart contracts until settlement.',
        ],
        callout: {
          kind: 'tip',
          title: 'Zero Gas Token Friction on Arc',
          body: 'Because Arc L1 uses USDC natively for transaction fees with sub-second deterministic finality, users never need to buy volatile L1 gas tokens just to open, pay, or release an escrow order.',
        },
      },
      {
        id: 'core-modules',
        title: 'Core Platform Modules',
        paragraphs: [
          'OnPeer unifies four complementary money flows into a single wallet-connected interface:',
        ],
        bullets: [
          'P2P Marketplace (/p2p): Multi-asset escrow orderbook supporting USDC and EURC across 8 South Asian fiat corridors with 0% trade fees.',
          'Instant Token Swap (/swap): On-chain swaps on Arc Mainnet powered by AchSwap (and Circle App Kit on Arc Testnet) with live quotes and slippage controls.',
          'Cross-Chain Bridge (/bridge): Native burn-and-mint USDC transfers across EVM networks via Circle CCTP v2, plus EURC bridging via Circle CCTPx.',
          'AI Trading Assistant (/assistant): Natural-language P2P ad discovery, swap, and bridge preparation that never touches private keys.',
        ],
      },
      {
        id: 'sdk-integration-preview',
        title: 'Reading Live Escrow State',
        paragraphs: [
          'Every OnPeer escrow market exposes deterministic read methods via standard EVM JSON-RPC using viem:',
        ],
        code: {
          filename: 'read-escrow.ts',
          language: 'typescript',
          code: `import { createPublicClient, http } from "viem";
import { p2pEscrowAbi } from "@/abi/p2pEscrow";

const client = createPublicClient({
  transport: http("https://rpc.mainnet.arc.io"),
});

export async function fetchOrderSummary(escrow: \`0x\${string}\`, orderId: bigint) {
  const order = await client.readContract({
    address: escrow,
    abi: p2pEscrowAbi,
    functionName: "getOrder",
    args: [orderId],
  });
  return { buyer: order.buyer, seller: order.seller, status: order.status };
}`,
        },
      },
    ],
  },
  {
    slug: 'quickstart',
    title: 'Quickstart Guide',
    shortDescription: 'Connect an EVM wallet on Arc Mainnet, fund gas in USDC, add payment rails, and complete your first trade.',
    category: 'Getting Started',
    sections: [
      {
        id: 'connect-wallet',
        title: '1. Connect Your Wallet',
        paragraphs: [
          'Open app.onpeer.xyz and connect MetaMask, Rabby, Rainbow, or any WalletConnect-compatible EVM wallet. When prompted, approve switching to Arc Mainnet (Chain ID: 5042).',
          'Always keep at least 0.50–1.00 USDC in your wallet on Arc Mainnet so you can sign approvals, mark payments, or post ads smoothly.',
        ],
      },
      {
        id: 'configure-profile',
        title: '2. Set Display Alias & Saved Payment Methods',
        paragraphs: [
          'Navigate to P2P → User Center to set your public Display Alias and add up to 20 saved receiving accounts (e.g., bKash, Nagad, UPI, or Bank Transfer).',
          'Saved payment details are encrypted with AES-256-GCM before storage and automatically prefill whenever you post a Sell ad or sell into a Buy ad.',
        ],
        callout: {
          kind: 'warning',
          title: 'Account Holder Name Consistency',
          body: 'Ensure your bank or mobile-wallet account owner name matches your verified legal identity. Counterparties are instructed to reject third-party transfers.',
        },
      },
      {
        id: 'complete-first-trade',
        title: '3. Execute a P2P Trade, Swap, or Bridge',
        paragraphs: [
          'Choose USDC or EURC in the P2P market bar, filter by your local currency and payment method, and click Buy or Sell to lock the exchange rate and start the escrow timer.',
        ],
        code: {
          filename: 'arc-network-config.json',
          language: 'json',
          code: `{
  "chainId": 5042,
  "chainName": "Arc Mainnet",
  "nativeCurrency": { "name": "USDC", "symbol": "USDC", "decimals": 18 },
  "rpcUrls": ["https://rpc.mainnet.arc.io"],
  "blockExplorerUrls": ["https://arc.etherscan.io", "https://explorer.arc.io"]
}`,
        },
      },
    ],
  },
  {
    slug: 'supported-assets',
    title: 'Supported Assets & Corridors',
    shortDescription: 'Decimal precision, token contracts, and regional South Asian payment methods supported on OnPeer.',
    badge: '2 Coins',
    category: 'Getting Started',
    sections: [
      {
        id: 'crypto-assets',
        title: 'Supported Cryptocurrencies',
        paragraphs: [
          'OnPeer supports Circle-backed stablecoins across P2P Escrow, Swap, and Cross-Chain Bridge. Each asset uses its canonical ERC-20 decimal precision on Arc Testnet:',
        ],
        table: {
          headers: ['Asset', 'Name', 'Decimals', 'P2P Escrow', 'Swap', 'Bridge Protocol'],
          rows: [
            ['USDC', 'USD Coin (Arc Native Gas + ERC-20)', '6', 'Live', 'Live', 'Circle CCTP v2 (7 Chains)'],
            ['EURC', 'Euro Coin', '6', 'Live', 'Live', 'Circle CCTPx (EVM Routes)'],
            ['cirBTC', 'Circle Wrapped Bitcoin', '8', 'Swap & Bridge', 'Live', 'Circle CCTPx (Sepolia ↔ Arc)'],
            ['WETH', 'Wrapped Ether on Arc', '18', 'Swap & Bridge', 'Live', 'Circle CCTPx (Sepolia ↔ Arc)'],
          ],
        },
        callout: {
          kind: 'note',
          title: 'Dual USDC Representation on Arc',
          body: 'On Arc L1, native gas balances use 18 decimals while the canonical USDC ERC-20 interface (0x3600...0000) uses 6 decimals over the exact same underlying balance. OnPeer uses strict integer scaling in src/onchain-money.ts so precision is never mixed.',
        },
      },
      {
        id: 'fiat-corridors',
        title: 'South Asian Fiat Corridors',
        paragraphs: [
          'All four crypto markets support 8 regional currencies with localized payment-method bitmasks enforced directly on-chain:',
        ],
        renderCustom: 'corridors',
      },
    ],
  },
  {
    slug: 'escrow-lifecycle',
    title: 'P2P Escrow Lifecycle',
    shortDescription: 'Step-by-step state machine for Sell ads, Buy ads, sealed payment details, late-payment grace windows, and fees.',
    badge: 'v2.1',
    category: 'P2P Marketplace',
    sections: [
      {
        id: 'fee-schedule',
        title: '0% Trade Fee & Flat Listing Fee',
        paragraphs: [
          'OnPeer charges 0% maker and 0% taker fees on P2P orders, chat messages, ad refreshes, and dispute filings.',
          'Creating a new Buy or Sell ad charges a flat 0.05 USDC / 0.05 EURC listing fee to prevent orderbook spam. Extending an ad’s TTL (1–168 hours) via refreshAd is completely free.',
        ],
      },
      {
        id: 'order-state-machine',
        title: 'Order State Machine',
        paragraphs: [
          'Every P2P order progresses through deterministic smart-contract states that neither governance nor backend servers can bypass:',
        ],
        bullets: [
          '1. Pending (Escrow Locked): For a Sell ad, inventory is already locked in the contract; for a Buy ad, the taker locks crypto on openOrder().',
          '2. Details Modes (Plain / Handshake / Auto-Reveal): Supports public details (Mode 0), seller handshake reveal within 10 minutes (Mode 1), or instant encrypted reveal to the matched buyer (Mode 2).',
          '3. Paid (Buyer Attestation): Buyer sends fiat off-chain and calls markPaid(orderId, payerProof) before the payment window (15–1440m) expires.',
          '4. 5-Minute Late Payment Recovery: If the countdown just expired after the buyer sent fiat, markPaid remains open for 5 extra minutes when accompanied by a non-zero transfer reference hash (max 2 late marks per 30 days).',
          '5. Completed (Crypto Released): Seller verifies fiat receipt in their bank/wallet app and calls release(orderId), transferring full escrow to the buyer and unlocking mutual post-trade ratings.',
        ],
        code: {
          filename: 'P2PEscrow.sol (Fiat Calculation)',
          language: 'solidity',
          code: `// Exact decimal-aware fiat calculation (scaled to 1e6 micro-fiat units)
// TOKEN_UNIT is 1e6 for USDC/EURC, 1e8 for cirBTC, and 1e18 for WETH
unchecked {
    order.fiatAmountE6 = uint256(amount) * uint256(ad.priceE6) / uint256(TOKEN_UNIT);
}`,
        },
      },
    ],
  },
  {
    slug: 'tiers-and-margin',
    title: 'Account Tiers & Merchant Margin',
    shortDescription: 'Progressive per-order caps, KYC tier boosts, Buy-ad eligibility gates, and slashable merchant security deposits.',
    category: 'P2P Marketplace',
    sections: [
      {
        id: 'progressive-tiers',
        title: 'Progressive Account Tiers',
        paragraphs: [
          'To protect sellers against order-lock griefing and chargeback fraud, taker order sizes scale automatically with qualifying trades (≥ 10 USDC/EURC each with unique counterparties) and account age:',
        ],
        table: {
          headers: ['Tier', 'Qualification Criteria', 'USDC / EURC Cap'],
          rows: [
            ['Tier 0 — Starter', 'New wallet (0 qualifying trades)', '200'],
            ['Tier 1 — Active', '1+ trade OR active Merchant Margin', '500'],
            ['Tier 2 — Established', '5+ trades & ≥ 7 days since first trade', '2,000'],
            ['Tier 3 — Trusted', '20+ trades & ≥ 14 days account age', 'Uncapped'],
          ],
        },
        callout: {
          kind: 'tip',
          title: 'KYC Verification Levels (L1 / L2 / L3)',
          body: 'L1 (Basic Verified) satisfies onchain KYC checks. L2 (Full Didit ID + Liveness) automatically lifts Tier 0, Tier 1, or Tier 2 accounts by +1 tier with zero PII stored onchain. L3 is reserved for future Business/KYB desks.',
        },
      },
      {
        id: 'merchant-collateral',
        title: 'Verified Merchant Margin & Buy-Ad Gate',
        paragraphs: [
          'Posting a Buy Ad requires either an active Merchant badge or at least 3 completed trades with distinct counterparties.',
          'Traders can deposit 100+ USDC/EURC security collateral via depositMargin() to earn the Bronze/Verified Merchant badge immediately. Withdrawals enforce a 7-day timelock and require zero open orders.',
        ],
      },
    ],
  },
  {
    slug: 'disputes-and-arbitration',
    title: 'Disputes & Arbitration',
    shortDescription: 'Zero-upfront-fee dispute filing, 30-minute cooling-off settlements, arbiter review, and FIFO bond debt.',
    category: 'P2P Marketplace',
    sections: [
      {
        id: 'opening-disputes',
        title: 'Filing a Dispute (0 Upfront Balance Needed)',
        paragraphs: [
          'Once an order is marked Paid, either party can submit encrypted evidence statements and receipts off-chain or trigger on-chain openDispute(orderId) (sellers immediately; buyers 15 minutes after marking paid).',
          'No upfront token balance is required in your wallet to open a dispute—ensuring a user with zero free liquidity is never locked out of arbitration.',
        ],
      },
      {
        id: 'cooling-off-and-bonds',
        title: 'Cooling-Off Window & Dispute Bonds',
        paragraphs: [
          'Parties can self-settle at any time while Disputed (seller calls release() or buyer calls cancelOrder()) with zero dispute bond charged:',
        ],
        bullets: [
          'Within 30 minutes before arbiter review (Cooling-Off): Clean settlement—0 bond, 0 strikes, 0 dispute losses.',
          'After 30 minutes before takeCase(): Recorded as 1 concession (2 concessions = 1 effective lost dispute), still 0 bond.',
          'After arbiter calls takeCase(): Recorded as 1 lost dispute, still 0 bond if self-settled before ruling.',
          'Formal Arbiter Ruling (resolveDispute): Full escrow goes to the winner. If applyBond == true, the loser owes ~2–5 USD equivalent (5% of order) deducted from free margin first or recorded as FIFO on-chain debt.',
          '7-Day Backup Arbiter Fail-Safe: If the primary arbiter does not act within 7 days, backupArbiter automatically gains jurisdiction.',
        ],
      },
    ],
  },
  {
    slug: 'safety-and-anti-scam',
    title: 'Anti-Scam & Safety Rules',
    shortDescription: 'Mandatory third-party transfer protections, SMS spoof defenses, and cancellation cooldown policies.',
    category: 'P2P Marketplace',
    sections: [
      {
        id: 'name-mismatch-policy',
        title: 'Strict Name-Match & Triangulation Defense',
        paragraphs: [
          'Every P2P order room enforces a mandatory warning banner in encrypted chat: never send or accept fiat from a third-party account.',
        ],
        callout: {
          kind: 'warning',
          title: 'Mandatory Counterparty Name Verification',
          body: 'If the payer’s bank or mobile-wallet account name does NOT match their verified identity on OnPeer, DO NOT proceed with the transfer or release crypto. OnPeer bears no liability if a user voluntarily transacts after a name mismatch.',
        },
      },
      {
        id: 'seller-and-buyer-rules',
        title: 'Golden Rules for Buyers & Sellers',
        paragraphs: [
          'Follow these operational checks on every trade to eliminate off-chain payment fraud:',
        ],
        bullets: [
          'Never rely on SMS notifications or chat screenshots alone—log directly into your bKash, Nagad, UPI, or bank app and confirm settled available balance before clicking Release.',
          'Never tap "I Have Paid" before your fiat transfer has actually left your bank/mobile wallet.',
          'Keep all communication inside OnPeer’s AES-256-GCM encrypted order chat; arbiters do not accept unverified Telegram or WhatsApp logs.',
          '3 buyer cancellations of Pending orders within 24 hours trigger an automatic 24-hour entry cooldown (existing open orders can always still be completed).',
        ],
      },
    ],
  },
  {
    slug: 'swap',
    title: 'Instant Token Swap',
    shortDescription: 'Swap between USDC, EURC, cirBTC, and WETH on Arc with explicit quote review and slippage bounds.',
    badge: 'App Kit',
    category: 'Cross-Chain & Liquidity',
    sections: [
      {
        id: 'how-swap-works',
        title: 'Keyless Browser Swaps on Arc',
        paragraphs: [
          'The /swap page and inline AI Assistant SwapCard use Circle App Kit (@circle-fin/app-kit) with the Viem v2 browser wallet adapter to quote and execute swaps between USDC, EURC, cirBTC, and WETH on Arc.',
          'Every swap enforces a strict two-step flow: first estimateSwap() fetches expected output and provider fees; only an explicit user click on the Swap button signs and broadcasts swap().',
        ],
        code: {
          filename: 'swap-example.ts',
          language: 'typescript',
          code: `import { AppKit } from "@circle-fin/app-kit";

const kit = new AppKit();

// 1. Preview live quote & provider fees (never moves funds)
const estimate = await kit.estimateSwap({
  from: { adapter, chain: "Arc_Testnet" },
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "50.00",
  config: { slippageBps: 100 }, // 1.00% max slippage
});

// 2. Execute only from an explicit user button click
const result = await kit.swap({
  from: { adapter, chain: "Arc_Testnet" },
  tokenIn: "USDC",
  tokenOut: "EURC",
  amountIn: "50.00",
  config: { slippageBps: 100 },
});`,
        },
      },
      {
        id: 'slippage-and-gas',
        title: 'Slippage Controls & Gas Reserve',
        paragraphs: [
          'Users can choose 0.5%, 1.0%, or 3.0% maximum slippage tolerance. When clicking MAX with USDC selected as input on Arc, OnPeer automatically reserves 1.00 USDC in your wallet so you never strand yourself without gas for future transactions.',
        ],
      },
    ],
  },
  {
    slug: 'bridge',
    title: 'Cross-Chain Bridge (CCTP & CCTPx)',
    shortDescription: 'Bridge USDC across 7 EVM chains via CCTP v2, plus EURC, cirBTC, and WETH via Circle CCTPx relayers.',
    badge: 'CCTP + CCTPx',
    category: 'Cross-Chain & Liquidity',
    sections: [
      {
        id: 'cctp-vs-cctpx',
        title: 'Unified CCTP v2 & CCTPx Architecture',
        paragraphs: [
          'OnPeer’s /bridge module routes both native USDC burns and expanded CCTPx assets through Circle App Kit with zero destination gas required from the user:',
        ],
        table: {
          headers: ['Token', 'Protocol', 'Testnet Chains', 'Settlement Steps'],
          rows: [
            ['USDC', 'CCTP v2 + Forwarding', 'Arc, Ethereum Sepolia, Base, Arbitrum, Optimism, Avalanche Fuji, Polygon Amoy', 'approve → burn → fetchAttestation → mint'],
            ['EURC', 'Circle CCTPx', 'Arc Testnet, Ethereum Sepolia, Base Sepolia, Avalanche Fuji', 'approve → transfer → fetchAttestation → forward'],
            ['cirBTC', 'Circle CCTPx', 'Ethereum Sepolia ↔ Arc Testnet', 'approve → transfer → fetchAttestation → forward'],
            ['WETH', 'Circle CCTPx (wETH)', 'Ethereum Sepolia ↔ Arc Testnet', 'approve → transfer → fetchAttestation → forward'],
          ],
        },
      },
      {
        id: 'speed-and-recovery',
        title: 'Transfer Speed (Fast vs Standard) & Safe Recovery',
        paragraphs: [
          'For CCTPx transfers (EURC, cirBTC, WETH), users can select Fast (pre-finality relayer settlement) or Standard (source-chain finality with lower fee). Quoted fees are passed to kit.bridge({ ...params, quote: estimate.quote }) and any QUOTE_NOT_REUSED or SPEED_DOWNGRADED notices are surfaced transparently.',
          'If a browser tab closes or a network blip interrupts a multi-step bridge, OnPeer never re-runs bridge() from scratch—clicking Retry calls kit.retryBridge(result) to resume safely from the last incomplete step.',
        ],
        code: {
          filename: 'bridge-cctpx.ts',
          language: 'typescript',
          code: `// Bridging EURC between Ethereum Sepolia and Arc Testnet via CCTPx
const estimate = await appKit.estimateBridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to: { adapter, chain: "Arc_Testnet" },
  amount: "10.00",
  token: "EURC",
  config: { transferSpeed: "FAST" },
});

// Confirmed by user click: Circle's relayer mints on the destination automatically
const result = await appKit.bridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to: { adapter, chain: "Arc_Testnet" },
  amount: "10.00",
  token: "EURC",
  config: { transferSpeed: "FAST" },
  quote: estimate.quote,
});`,
        },
      },
    ],
  },
  {
    slug: 'smart-contracts',
    title: 'Smart Contracts & Deployments',
    shortDescription: 'Verified P2PEscrow v2.3 contract addresses on Arc Mainnet (Chain ID 5042) with ArcScan Exact Match & Arc Explorer links.',
    badge: 'v2.3 Verified',
    category: 'Architecture & Reference',
    sections: [
      {
        id: 'deployed-contracts',
        title: 'Live Arc Mainnet Contract Registry',
        paragraphs: [
          'All OnPeer P2P Escrow contracts (v2.3) are immutable, non-custodial Solidity 0.8.28 deployments on Arc Mainnet (Chain ID: 5042), verified with Exact Match on ArcScan (arc.etherscan.io) and mirrored on Sourcify & Arc Explorer. Governance cannot sweep escrowed trade funds, and blocklisted recipients degrade gracefully into withdrawable claimable balances so one bad actor never bricks another user’s order.',
        ],
        callout: {
          kind: 'note',
          title: 'Compiler & Verification Details (Exact Match on ArcScan)',
          body: 'Compiled with Solidity v0.8.28+commit.7893614a (evm_version: cancun, via_ir: true, optimizer_runs: 1, MIT license) with bytecode_hash = "none" and cbor_metadata = false to stay under the 24 KB EVM bytecode size limit. ArcScan verifies the deployed bytecode as an Exact Match; Blockscout/Sourcify label all metadata-stripped contracts as "partial match" solely because CBOR metadata is intentionally omitted, even though executable bytecode is 100% identical.',
        },
        renderCustom: 'contracts',
      },
      {
        id: 'scoped-order-ids',
        title: 'Multi-Asset Scoped Order & Ad IDs',
        paragraphs: [
          'To keep off-chain encrypted chat, vault commitments, disputes, and post-trade feedback collision-free across four independent escrow contracts without altering Postgres BIGINT keys, OnPeer namespaces non-USDC IDs deterministically:',
        ],
        code: {
          filename: 'scoped-ids.ts',
          language: 'typescript',
          code: `// Deterministic collision-free 64-bit safe order/ad ID encoding
export const ASSET_ID_OFFSET = {
  USDC:   0n,                 // 1 .. 999,999,999,999
  EURC:   1_000_000_000_000n, // 1,000,000,000,001+
  cirBTC: 2_000_000_000_000n, // 2,000,000,000,001+
  WETH:   3_000_000_000_000n, // 3,000,000,000,001+
} as const;`,
        },
      },
    ],
  },
  {
    slug: 'encryption-architecture',
    title: 'Vault & Zero-PII Encryption',
    shortDescription: 'AES-256-GCM envelope encryption, EIP-191 wallet sessions, Didit HMAC webhooks, and automated retention sweeps.',
    badge: 'AES-256',
    category: 'Architecture & Reference',
    sections: [
      {
        id: 'envelope-encryption',
        title: 'AES-256-GCM Envelope Encryption',
        paragraphs: [
          'No personal data, bank account numbers, chat messages, or KYC documents are ever written to the blockchain. On-chain contracts store only 32-byte keccak256 commitments (detailsHash, payerProof) and boolean/tier flags.',
          'All off-chain payment details, order chat messages, and dispute evidence are sealed by the Cloudflare Worker (`worker/crypto.ts`) using per-record random Data Encryption Keys (DEKs), random 96-bit IVs, and strict Additional Authenticated Data (AAD) binding each ciphertext to its exact order ID or wallet.',
        ],
        callout: {
          kind: 'tip',
          title: 'Prompt-Injection Hygiene',
          body: 'User-authored ad notes, payment details, and order chat messages are never passed into the AI Assistant context window, eliminating indirect prompt-injection vectors.',
        },
      },
      {
        id: 'session-and-retention',
        title: 'Wallet-Sig Auth & Automated Data Retention',
        paragraphs: [
          'API authentication uses gasless EIP-191 personal_sign challenges (`POST /api/auth/nonce` → `POST /api/auth/verify`), storing only SHA-256 hashes of 12-hour session tokens in Supabase Postgres via Cloudflare Hyperdrive.',
          'A scheduled Worker cron runs every minute (`* * * * *`) to process transactional email notifications, sync KYC expirations, and permanently purge expired chat logs, vault blobs, and stale sessions.',
        ],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Syntax Token Highlighter (Zero external runtime dependency, crisp colors)
// ---------------------------------------------------------------------------

function renderHighlightedLine(line: string): React.ReactNode {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('//')) {
    return <span className="text-emerald-400/80 italic">{line}</span>
  }
  // Tokenize strings, keywords, numbers, and identifiers cleanly
  const pattern = /("[^"]*"|'[^']*'|`[^`]*`|\b(?:import|from|export|const|let|async|await|function|return|if|else|unchecked|uint256|uint128|bigint|true|false)\b|\b\d+(?:_\d+)*(?:n|e\d+)?\b)/g
  const parts = line.split(pattern)
  return parts.map((part, idx) => {
    if (!part) return null
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'")) ||
      (part.startsWith('`') && part.endsWith('`'))
    ) {
      return (
        <span key={idx} className="text-amber-300">
          {part}
        </span>
      )
    }
    if (
      /^(?:import|from|export|const|let|async|await|function|return|if|else|unchecked|uint256|uint128|bigint|true|false)$/.test(
        part,
      )
    ) {
      return (
        <span key={idx} className="font-semibold text-pink-400">
          {part}
        </span>
      )
    }
    if (/^\d+(?:_\d+)*(?:n|e\d+)?$/.test(part)) {
      return (
        <span key={idx} className="text-sky-300">
          {part}
        </span>
      )
    }
    return (
      <span key={idx} className="text-slate-200">
        {part}
      </span>
    )
  })
}

function CodeBlock({ snippet }: { snippet: CodeSnippet }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => snippet.code.split('\n'), [snippet.code])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code)
      setCopied(true)
      toast.success(`Copied ${snippet.filename}`)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Could not copy code')
    }
  }

  return (
    <div
      className="my-5 overflow-hidden rounded-2xl border transition-all"
      style={{
        background: '#0D1321',
        borderColor: 'color-mix(in srgb, var(--border-strong) 80%, rgba(255,255,255,0.08))',
        boxShadow: '0 18px 42px -18px rgba(0,0,0,0.55)',
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#FF5A00]/80" />
          <span className="font-mono text-xs font-medium text-slate-300">{snippet.filename}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-400">
            {snippet.language}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy code"
            title="Copy code"
            className="inline-flex size-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse code' : 'Expand code'}
            title={expanded ? 'Collapse' : 'Expand'}
            className="inline-flex size-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </div>
      </div>

      <div className={`overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-6 ${expanded ? '' : 'max-h-[340px]'}`}>
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="w-9 select-none pr-4 text-right text-[11px] text-slate-500">{i + 1}</td>
                <td className="whitespace-pre">{renderHighlightedLine(line)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CalloutCard({
  kind,
  title,
  body,
}: {
  kind: CalloutKind
  title: string
  body: string
}) {
  const accentColor =
    kind === 'warning' ? '#F59E0B' : kind === 'note' ? '#38BDF8' : '#FF5A00'
  const Icon = kind === 'warning' ? ShieldAlert : kind === 'note' ? Zap : MessageSquare

  return (
    <div
      className="my-5 rounded-2xl border p-4 sm:p-5"
      style={{
        background: `color-mix(in srgb, ${accentColor} 7%, var(--fill-1))`,
        borderColor: `color-mix(in srgb, ${accentColor} 34%, var(--border))`,
      }}
    >
      <div className="flex items-center gap-2.5 text-sm font-bold" style={{ color: accentColor }}>
        <Icon className="size-4 shrink-0" />
        <span>{title}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed sm:text-[13.5px]" style={{ color: 'var(--ink)' }}>
        {body}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// URL Helpers for docs.onpeer.xyz vs /docs/<slug>
// ---------------------------------------------------------------------------

function slugFromPathname(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '')
  const raw = clean.startsWith('/docs/')
    ? clean.slice('/docs/'.length)
    : clean === '/docs' || clean === '' || clean === '/'
      ? 'overview'
      : clean.replace(/^\/+/, '')
  return DOC_PAGES.some((p) => p.slug === raw) ? raw : 'overview'
}

function buildDocPath(slug: string): string {
  if (isDocsSubdomain()) {
    return slug === 'overview' ? '/' : `/${slug}`
  }
  return slug === 'overview' ? '/docs' : `/docs/${slug}`
}

function appHref(path: string): string {
  return isDocsSubdomain() ? `${APP_URL}${path}` : path
}

// ---------------------------------------------------------------------------
// Main 3-Column Documentation Portal
// ---------------------------------------------------------------------------

export default function DocsPage() {
  const pathname = usePathname()
  const activeSlug = useMemo(() => slugFromPathname(pathname), [pathname])
  const pageIndex = useMemo(
    () => Math.max(0, DOC_PAGES.findIndex((p) => p.slug === activeSlug)),
    [activeSlug],
  )
  const activePage = DOC_PAGES[pageIndex] ?? DOC_PAGES[0]
  const prevPage = pageIndex > 0 ? DOC_PAGES[pageIndex - 1] : null
  const nextPage = pageIndex < DOC_PAGES.length - 1 ? DOC_PAGES[pageIndex + 1] : null

  const [activeSectionId, setActiveSectionId] = useState<string>(
    () => activePage.sections[0]?.id ?? '',
  )
  const effectiveSectionId = activePage.sections.some((s) => s.id === activeSectionId)
    ? activeSectionId
    : (activePage.sections[0]?.id ?? '')
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DOC_CATEGORIES.map((c) => [c, false])),
  )
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [versionOpen, setVersionOpen] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const versionRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [])

  // Real-time Scroll-Spy: tracks the currently visible section on every scroll & resize frame!
  useEffect(() => {
    const sectionIds = activePage.sections.map((s) => s.id)
    if (sectionIds.length === 0) return

    let rafId = 0
    const computeActive = () => {
      const scrollBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 36
      if (scrollBottom) {
        setActiveSectionId(sectionIds[sectionIds.length - 1])
        return
      }
      const threshold = 152 // sticky header + breathing room
      let current = sectionIds[0]
      for (const id of sectionIds) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top
        if (top <= threshold) {
          current = id
        } else {
          break
        }
      }
      setActiveSectionId(current)
    }

    const onScroll = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(computeActive)
    }

    rafId = requestAnimationFrame(computeActive)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [activePage])

  // Cmd/Ctrl + K keyboard shortcut for instant docs search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => {
          if (prev) setSearchQuery('')
          return !prev
        })
      } else if (e.key === 'Escape') {
        closeSearch()
        setVersionOpen(false)
        setMobileNavOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeSearch])

  useEffect(() => {
    if (!searchOpen) return
    const timer = setTimeout(() => searchInputRef.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [searchOpen])

  useEffect(() => {
    if (!versionOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (versionRef.current && !versionRef.current.contains(e.target as Node)) {
        setVersionOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [versionOpen])

  const goToPage = useCallback((slug: string, hashId?: string) => {
    setMobileNavOpen(false)
    closeSearch()
    navigate(buildDocPath(slug))
    if (hashId) {
      setTimeout(() => {
        const target = document.getElementById(hashId)
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          setActiveSectionId(hashId)
        }
      }, 60)
    }
  }, [closeSearch])

  const scrollToSection = useCallback((id: string) => {
    setActiveSectionId(id)
    setMobileNavOpen(false)
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const copyText = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      toast.success(`${label} copied`)
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800)
    } catch {
      toast.error('Could not copy')
    }
  }

  const canonicalUrlDisplay = `docs.onpeer.xyz/${activePage.slug === 'overview' ? '' : activePage.slug}`.replace(
    /\/$/,
    '',
  )
  const canonicalUrlFull =
    activePage.slug === 'overview' ? DOCS_URL : `${DOCS_URL}/${activePage.slug}`

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) {
      return DOC_PAGES.map((p) => ({
        slug: p.slug,
        pageTitle: p.title,
        sectionId: p.sections[0]?.id ?? '',
        sectionTitle: p.shortDescription,
        category: p.category,
      }))
    }
    const hits: {
      slug: string
      pageTitle: string
      sectionId: string
      sectionTitle: string
      category: string
    }[] = []
    for (const page of DOC_PAGES) {
      for (const sec of page.sections) {
        const hay = [
          page.title,
          page.shortDescription,
          sec.title,
          ...sec.paragraphs,
          ...(sec.bullets ?? []),
        ]
          .join(' ')
          .toLowerCase()
        if (hay.includes(q)) {
          hits.push({
            slug: page.slug,
            pageTitle: page.title,
            sectionId: sec.id,
            sectionTitle: sec.title,
            category: page.category,
          })
        }
      }
    }
    return hits.slice(0, 14)
  }, [searchQuery])

  const contractRows = useMemo(() => {
    const isMainnet = CHAIN_ID === 5042
    const escrows = VISIBLE_P2P_ASSETS.map((asset: P2pAsset) => {
      const cfg = getEscrowConfig(asset)
      return {
        label: `P2PEscrow v2.3 (${asset})`,
        role: `Non-custodial ${asset} P2P escrow contract (Block ${cfg.deployBlock.toString()})`,
        address: cfg.escrowAddress,
        asset,
        verifiedArcScan: isMainnet,
      }
    })
    const libraries = isMainnet
      ? [
          {
            label: 'P2PEscrowDebtLib (Library)',
            role: 'Linked Solidity library handling FIFO dispute bond debt & settlement accounting (Block 33297066)',
            address: '0x3a00ccA2AE0dA3E9c45B49A166b60b4527475552',
            asset: undefined,
            verifiedArcScan: true,
          },
        ]
      : []
    const tokens = VISIBLE_P2P_ASSETS.map((asset: P2pAsset) => {
      const cfg = getEscrowConfig(asset)
      return {
        label: `${asset} Token (ERC-20)`,
        role: `${cfg.decimals}-decimal ERC-20 contract on Arc`,
        address: cfg.tokenAddress,
        asset,
        verifiedArcScan: false,
      }
    })
    const governance = isMainnet
      ? [
          {
            label: 'Owner / Fee Recipient',
            role: 'Protocol governance & listing-fee recipient (cannot sweep escrowed user funds)',
            address: '0x81eA9AdE2805e310E9f884a75B3a24Ab74557C69',
            asset: undefined,
            verifiedArcScan: false,
          },
          {
            label: 'Primary & Backup Arbiter',
            role: 'Dispute resolution authority with 7-day backup arbiter fail-safe',
            address: '0xb213Dc9a65d3d748B6Ec5cCaCCb9b6EC82A40A33',
            asset: undefined,
            verifiedArcScan: false,
          },
          {
            label: 'KYC Verifier Relayer',
            role: 'Attests Didit KYC status on-chain only (zero fund custody)',
            address: '0x74605c85676E9F514BA33B9B3005e0EE561DAfDd',
            asset: undefined,
            verifiedArcScan: false,
          },
        ]
      : [
          {
            label: 'CrossChainTokenService (CCTPx)',
            role: 'Circle CCTPx cross-chain token router on Arc Testnet (Domain 26)',
            address: '0x63753E722bd2C2A5DF6EE19C5106662208B81077',
            asset: undefined,
            verifiedArcScan: false,
          },
          {
            label: 'Verifier Relayer Wallet (Testnet)',
            role: 'Attests Didit KYC status on-chain (zero fund custody)',
            address: '0xeebd29441AF1a931C4a6eEc2265B0757fd992f5e',
            asset: undefined,
            verifiedArcScan: false,
          },
        ]
    return [...escrows, ...libraries, ...tokens, ...governance]
  }, [])

  const renderSidebarContent = () => (
    <div className="flex flex-col gap-6 pb-8">
      {/* Categorized Page Tree */}
      <nav aria-label="Documentation navigation" className="space-y-5">
        {DOC_CATEGORIES.map((category) => {
          const pages = DOC_PAGES.filter((p) => p.category === category)
          const expanded = openCategories[category] ?? false
          return (
            <div key={category}>
              <button
                type="button"
                onClick={() =>
                  setOpenCategories((prev) => ({ ...prev, [category]: !expanded }))
                }
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-bold tracking-wide transition-colors hover:bg-[var(--fill-2)]"
                style={{ color: 'var(--ink)' }}
              >
                <span className="flex items-center gap-2">
                  <span>{category}</span>
                  <span
                    className="rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                    style={{ background: 'var(--fill-2)', color: 'var(--subtle)' }}
                  >
                    {pages.length}
                  </span>
                </span>
                <ChevronDown
                  className={`size-3.5 opacity-65 transition-transform duration-200 ${expanded ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {expanded && (
                <ul className="mt-1.5 space-y-1">
                  {pages.map((p) => {
                    const active = p.slug === activePage.slug
                    return (
                      <li key={p.slug}>
                        <button
                          type="button"
                          onClick={() => goToPage(p.slug)}
                          aria-current={active ? 'page' : undefined}
                          className="flex w-full items-center justify-between gap-2 rounded-full px-3.5 py-2 text-left text-xs font-semibold transition-all"
                          style={{
                            background: active
                              ? 'color-mix(in srgb, var(--accent) 15%, var(--fill-2))'
                              : 'transparent',
                            border: active
                              ? '1px solid color-mix(in srgb, var(--accent) 36%, var(--border))'
                              : '1px solid transparent',
                            color: active ? 'var(--ink)' : 'var(--muted)',
                          }}
                        >
                          <span className="truncate">{p.title}</span>
                          {p.badge && (
                            <span
                              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                              style={{
                                background: active
                                  ? 'var(--accent-bg)'
                                  : 'var(--fill-2)',
                                color: active ? 'var(--on-accent)' : 'var(--subtle)',
                              }}
                            >
                              {p.badge}
                            </span>
                          )}
                        </button>

                        {/* Dynamic Scroll-Synced Sub-Sections on the Left Sidebar too! */}
                        {active && p.sections.length > 1 && (
                          <ul
                            className="ml-4 mt-1.5 space-y-0.5 border-l pl-3"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            {p.sections.map((sec) => {
                              const subActive = effectiveSectionId === sec.id
                              return (
                                <li key={sec.id}>
                                  <button
                                    type="button"
                                    onClick={() => scrollToSection(sec.id)}
                                    className="block w-full truncate py-1 text-left text-[11.5px] transition-colors"
                                    style={{
                                      color: subActive ? 'var(--accent)' : 'var(--subtle)',
                                      fontWeight: subActive ? 700 : 500,
                                    }}
                                  >
                                    {sec.title}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      {/* External Resources */}
      <div className="border-t pt-5" style={{ borderColor: 'var(--border)' }}>
        <p className="px-2.5 text-xs font-bold" style={{ color: 'var(--ink)' }}>
          Resources
        </p>
        <ul className="mt-2 space-y-1">
          {[
            { label: 'ArcScan (Verified Contracts)', href: 'https://arc.etherscan.io/address/0xC073b1A5ac4004fD82cAc6BDA5548FFc5E5cB97e#code' },
            { label: 'Arc Explorer', href: 'https://explorer.arc.io' },
            { label: 'Arc Network Docs', href: 'https://docs.arc.io' },
            { label: 'Circle CCTP & CCTPx', href: 'https://developers.circle.com/cctp' },
            {
              label: 'Privacy & Encryption',
              href: isDocsSubdomain() ? `${LANDING_URL}/privacy` : '/privacy',
            },
          ].map((item) => (
            <li key={item.label}>
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--fill-2)]"
                style={{ color: 'var(--muted)' }}
              >
                <span>{item.label}</span>
                <ArrowUpRight className="size-3.5 opacity-60" />
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom Help Card (Reference Screenshot Pattern) */}
      <div
        className="rounded-2xl border p-4"
        style={{
          background: 'color-mix(in srgb, var(--fill-2) 85%, transparent)',
          borderColor: 'var(--border-strong)',
        }}
      >
        <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
          Need help?
        </p>
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          Prepare trades, swaps, or bridges in plain English with the OnPeer Assistant.
        </p>
        <a
          href={appHref('/assistant')}
          onClick={(e) => {
            if (!isDocsSubdomain()) {
              e.preventDefault()
              navigate('/assistant')
            }
          }}
          className="mt-3 flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-transform hover:scale-[1.01]"
          style={{
            background: 'linear-gradient(135deg, rgba(255,90,0,0.18), rgba(255,90,0,0.05))',
            borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--border))',
            color: 'var(--ink)',
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-[#FF5A00]" />
            Ask AI Assistant
          </span>
          <ArrowRight className="size-3.5 text-[#FF5A00]" />
        </a>
      </div>
    </div>
  )

  return (
    <div className="relative z-10 min-h-dvh">
      {/* Top Documentation Bar (MaterialMe Reference Layout) */}
      <header
        className="sticky top-0 z-40 border-b backdrop-blur-2xl"
        style={{
          background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          {/* Left: Brand + Docs + Version Dropdown */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open documentation menu"
              className="inline-flex size-9 items-center justify-center rounded-xl border lg:hidden"
              style={{ background: 'var(--fill-2)', borderColor: 'var(--border)' }}
            >
              <Menu className="size-4" />
            </button>

            <a
              href={isDocsSubdomain() ? LANDING_URL : '/'}
              onClick={(e) => {
                if (!isDocsSubdomain()) {
                  e.preventDefault()
                  navigate('/')
                }
              }}
              aria-label="OnPeer home"
              className="group flex items-center gap-3"
            >
              <span className="glow-accent rounded-xl transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-105">
                <LogoMark size={40} />
              </span>
              <span
                className="script block text-2xl leading-tight"
                style={{ color: 'var(--accent)', textShadow: '0 0 18px var(--accent-glow)' }}
              >
                OnPeer
              </span>
            </a>

            {/* Docs + Version Selector Pill */}
            <div ref={versionRef} className="relative z-50 hidden sm:block">
              <button
                type="button"
                onClick={() => setVersionOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-semibold transition-colors hover:bg-[var(--fill-3)]"
                style={{
                  background: 'var(--fill-2)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--ink)',
                }}
              >
                <span>Docs · v2.3</span>
                <ChevronDown className="size-3 opacity-70" />
              </button>
              {versionOpen && (
                <div
                  className="absolute left-0 z-50 mt-2 w-60 rounded-2xl border p-1.5"
                  style={{
                    backgroundColor: 'var(--panel-solid)',
                    borderColor: 'var(--border-strong)',
                    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setVersionOpen(false)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold"
                    style={{ background: 'var(--fill-2)', color: 'var(--ink)' }}
                  >
                    <div>
                      <p>v2.3 — Arc Mainnet Live</p>
                      <p className="text-[10px] font-normal" style={{ color: 'var(--muted)' }}>
                        USDC &amp; EURC Verified (Current)
                      </p>
                    </div>
                    <Check className="size-3.5 text-[#FF5A00]" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Center: Search Documentation Trigger */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-10 flex-1 max-w-md items-center justify-between gap-3 rounded-full border px-4 text-xs transition-colors hover:border-[var(--border-strong)]"
            style={{
              background: 'var(--fill-2)',
              borderColor: 'var(--border)',
              color: 'var(--muted)',
            }}
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="size-3.5 shrink-0 opacity-75" />
              <span className="truncate">Search documentation...</span>
            </span>
            <kbd
              className="hidden rounded-md border px-1.5 py-0.5 font-mono text-[10px] sm:inline-block"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--subtle)' }}
            >
              Ctrl K
            </kbd>
          </button>

          {/* Right: Top Links + Theme + Launch App */}
          <div className="flex items-center gap-2 sm:gap-4">
            <nav aria-label="Documentation quick links" className="hidden items-center gap-5 text-xs font-semibold md:flex">
              <a
                href={appHref('/p2p')}
                onClick={(e) => {
                  if (!isDocsSubdomain()) {
                    e.preventDefault()
                    navigate('/p2p')
                  }
                }}
                className="transition-colors hover:text-[#FF5A00]"
                style={{ color: 'var(--muted)' }}
              >
                P2P Market
              </a>
              <a
                href={appHref('/swap')}
                onClick={(e) => {
                  if (!isDocsSubdomain()) {
                    e.preventDefault()
                    navigate('/swap')
                  }
                }}
                className="transition-colors hover:text-[#FF5A00]"
                style={{ color: 'var(--muted)' }}
              >
                Swap
              </a>
              <a
                href={appHref('/bridge')}
                onClick={(e) => {
                  if (!isDocsSubdomain()) {
                    e.preventDefault()
                    navigate('/bridge')
                  }
                }}
                className="transition-colors hover:text-[#FF5A00]"
                style={{ color: 'var(--muted)' }}
              >
                Bridge
              </a>
              <button
                type="button"
                onClick={() => goToPage('smart-contracts')}
                className="transition-colors hover:text-[#FF5A00]"
                style={{
                  color: activePage.slug === 'smart-contracts' ? 'var(--ink)' : 'var(--muted)',
                }}
              >
                Reference
              </button>
            </nav>

            <ThemeToggle />

            <a
              href={appHref('/p2p')}
              onClick={(e) => {
                if (!isDocsSubdomain()) {
                  e.preventDefault()
                  navigate('/p2p')
                }
              }}
              className="hidden items-center gap-1.5 rounded-full bg-[#FF5A00] px-3.5 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 sm:inline-flex"
            >
              <span>Launch App</span>
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* Mobile Horizontal On-This-Page Bar (auto-updates on scroll!) */}
      <div
        className="sticky top-16 z-30 flex gap-1.5 overflow-x-auto border-b px-4 py-2 backdrop-blur-xl xl:hidden"
        style={{
          background: 'color-mix(in srgb, var(--bg) 90%, transparent)',
          borderColor: 'var(--border)',
        }}
      >
        {activePage.sections.map((sec) => {
          const active = activeSectionId === sec.id
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => scrollToSection(sec.id)}
              className="shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition-all"
              style={{
                background: active
                  ? 'color-mix(in srgb, var(--accent) 16%, var(--fill-2))'
                  : 'var(--fill-1)',
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                color: active ? 'var(--ink)' : 'var(--muted)',
              }}
            >
              {sec.title}
            </button>
          )
        })}
      </div>

      {/* 3-Column Documentation Grid */}
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:px-10 xl:grid-cols-[252px_minmax(0,1fr)_232px] xl:gap-12">
        {/* Column 1: Left Navigation Sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2">
            {renderSidebarContent()}
          </div>
        </aside>

        {/* Column 2: Main Article Feed */}
        <main className="min-w-0 max-w-3xl pb-20">
          {/* Professional Hero Header Card */}
          <div
            className="mb-10 rounded-3xl border p-6 sm:p-7"
            style={{
              background: 'linear-gradient(145deg, color-mix(in srgb, var(--accent) 8%, var(--fill-1)), var(--fill-1))',
              borderColor: 'var(--border-strong)',
            }}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#FF5A00]">
              <BookOpen className="size-3.5" />
              <span className="uppercase tracking-wider">{activePage.category}</span>
              {activePage.badge && (
                <span
                  className="rounded-full border px-2.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'var(--fill-2)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  {activePage.badge}
                </span>
              )}
            </div>
            <h1 className="display mt-3 text-2xl font-extrabold tracking-tight sm:text-4xl">
              {activePage.title}
            </h1>
            <p className="mt-3 text-sm leading-relaxed sm:text-[15px]" style={{ color: 'var(--muted)' }}>
              {activePage.shortDescription}
            </p>
          </div>

          {/* Page Sections */}
          <div className="space-y-12">
            {activePage.sections.map((sec) => (
              <section
                key={sec.id}
                id={sec.id}
                data-doc-section={sec.id}
                className="scroll-mt-28"
              >
                <div className="flex items-center gap-2.5 border-b pb-2.5" style={{ borderColor: 'var(--border)' }}>
                  <span className="h-5 w-1 rounded-full bg-[#FF5A00]" />
                  <h2 className="display text-lg font-bold tracking-tight sm:text-2xl">
                    {sec.title}
                  </h2>
                </div>

                <div className="mt-3 space-y-3 text-sm leading-7" style={{ color: 'var(--muted)' }}>
                  {sec.paragraphs.map((p, idx) => (
                    <p key={idx}>{p}</p>
                  ))}
                </div>

                {sec.bullets && (
                  <ul className="mt-4 space-y-2.5 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
                    {sec.bullets.map((b, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs sm:text-[13.5px]"
                        style={{ background: 'var(--fill-1)', borderColor: 'var(--border)' }}
                      >
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#FF5A00]" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {sec.code && <CodeBlock snippet={sec.code} />}

                {sec.callout && (
                  <CalloutCard
                    kind={sec.callout.kind}
                    title={sec.callout.title}
                    body={sec.callout.body}
                  />
                )}

                {sec.table && (
                  <div
                    className="my-5 overflow-x-auto rounded-2xl border"
                    style={{ background: 'var(--fill-1)', borderColor: 'var(--border)' }}
                  >
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead>
                        <tr
                          className="border-b uppercase tracking-wider"
                          style={{ background: 'var(--fill-2)', borderColor: 'var(--border)', color: 'var(--subtle)' }}
                        >
                          {sec.table.headers.map((h) => (
                            <th key={h} className="px-4 py-3 font-bold">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                        {sec.table.rows.map((row, rIdx) => (
                          <tr key={rIdx} className="transition-colors hover:bg-[var(--fill-2)]/60">
                            {row.map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className={`px-4 py-3 ${cIdx === 0 ? 'font-bold' : ''}`}
                                style={{ color: cIdx === 0 ? 'var(--ink)' : 'var(--muted)' }}
                              >
                                {cIdx === 0 && ['USDC', 'EURC', 'cirBTC', 'WETH'].includes(cell) ? (
                                  <span className="inline-flex items-center gap-2">
                                    <CoinLogo symbol={cell} size={16} />
                                    {cell}
                                  </span>
                                ) : (
                                  cell
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {sec.renderCustom === 'corridors' && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {COUNTRIES.map((c) => (
                      <div
                        key={c.code}
                        className="rounded-2xl border p-4"
                        style={{ background: 'var(--fill-1)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 text-sm font-bold">
                            <CountryFlag code={c.code} size={20} />
                            {c.name}
                          </span>
                          <span
                            className="rounded-md px-2 py-0.5 font-mono text-xs font-bold"
                            style={{ background: 'var(--fill-2)', color: 'var(--accent)' }}
                          >
                            {c.symbol} {c.currency}
                          </span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {methodsForCountry(c.code).map((m) => (
                            <span
                              key={m.bit}
                              className="rounded-md border px-2 py-0.5 text-[11px] font-medium"
                              style={{
                                background: 'var(--fill-2)',
                                borderColor: 'var(--border)',
                                color: 'var(--ink)',
                              }}
                            >
                              {m.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {sec.renderCustom === 'contracts' && (
                  <div className="mt-5 space-y-2.5">
                    {contractRows.map((row) => (
                      <div
                        key={row.label}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
                        style={{ background: 'var(--fill-1)', borderColor: 'var(--border)' }}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {row.asset && <CoinLogo symbol={row.asset} size={16} />}
                            <p className="text-xs font-bold sm:text-sm" style={{ color: 'var(--ink)' }}>
                              {row.label}
                            </p>
                            {row.verifiedArcScan && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                                <Check className="size-3" /> Exact Match
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                            {row.role}
                          </p>
                          <p
                            className="mt-1.5 break-all font-mono text-[11.5px] font-semibold"
                            style={{ color: 'var(--accent)' }}
                          >
                            {row.address}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void copyText(row.label, row.address, row.label)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors hover:bg-[var(--fill-3)]"
                            style={{ background: 'var(--fill-2)', borderColor: 'var(--border)' }}
                          >
                            {copiedKey === row.label ? (
                              <Check className="size-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                            Copy
                          </button>
                          {row.verifiedArcScan && (
                            <a
                              href={`https://arc.etherscan.io/address/${row.address}#code`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                            >
                              ArcScan <ExternalLink className="size-3" />
                            </a>
                          )}
                          <a
                            href={buildAddressExplorerUrl(CHAIN_ID, row.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors hover:bg-[var(--fill-3)]"
                            style={{ background: 'var(--fill-2)', borderColor: 'var(--border)' }}
                          >
                            Explorer <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* Bottom Prev / Next Page Cards (Exact Reference Screenshot Pattern) */}
          <div
            className="mt-14 grid gap-4 border-t pt-8 sm:grid-cols-2"
            style={{ borderColor: 'var(--border)' }}
          >
            {prevPage ? (
              <button
                type="button"
                onClick={() => goToPage(prevPage.slug)}
                className="group flex flex-col justify-between rounded-2xl border p-5 text-left transition-all hover:border-[#FF5A00]/60 hover:bg-[var(--fill-2)]"
                style={{ background: 'var(--fill-1)', borderColor: 'var(--border-strong)' }}
              >
                <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  <ArrowLeft className="size-4 text-[#FF5A00] transition-transform group-hover:-translate-x-1" />
                  <span>{prevPage.title}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {prevPage.shortDescription}
                </p>
              </button>
            ) : (
              <div className="hidden sm:block" />
            )}

            {nextPage && (
              <button
                type="button"
                onClick={() => goToPage(nextPage.slug)}
                className="group flex flex-col justify-between rounded-2xl border p-5 text-left transition-all hover:border-[#FF5A00]/60 hover:bg-[var(--fill-2)]"
                style={{ background: 'var(--fill-1)', borderColor: 'var(--border-strong)' }}
              >
                <div className="flex items-center justify-between gap-2 text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  <span>{nextPage.title}</span>
                  <ArrowRight className="size-4 text-[#FF5A00] transition-transform group-hover:translate-x-1" />
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {nextPage.shortDescription}
                </p>
              </button>
            )}
          </div>
        </main>

        {/* Column 3: Right "On this page" Live Scroll-Spy Sidebar */}
        <aside className="hidden xl:block">
          <div className="sticky top-24 space-y-6">
            {/* Canonical docs.onpeer.xyz URL Copy Pill (Reference Screenshot Top-Right Pill) */}
            <button
              type="button"
              onClick={() => void copyText('canonical-url', canonicalUrlFull, 'Docs link')}
              title="Copy canonical docs.onpeer.xyz link"
              className="flex w-full items-center justify-between gap-2 rounded-full border px-3.5 py-2.5 text-left font-mono text-[11px] font-medium transition-colors hover:border-[#FF5A00]/60 hover:bg-[var(--fill-3)]"
              style={{
                background: 'var(--fill-2)',
                borderColor: 'var(--border-strong)',
                color: 'var(--ink)',
              }}
            >
              <span className="inline-flex min-w-0 items-center gap-2 truncate">
                <Link2 className="size-3.5 shrink-0 text-[#FF5A00]" />
                <span className="truncate">{canonicalUrlDisplay}</span>
              </span>
              {copiedKey === 'canonical-url' ? (
                <Check className="size-3.5 shrink-0 text-emerald-500" />
              ) : (
                <Copy className="size-3 shrink-0 opacity-60" />
              )}
            </button>

            {/* On This Page Live Scroll-Spy List */}
            <div>
              <p className="px-3 text-xs font-bold" style={{ color: 'var(--ink)' }}>
                On this page
              </p>
              <ul className="mt-2.5 space-y-1">
                {activePage.sections.map((sec) => {
                  const active = effectiveSectionId === sec.id
                  return (
                    <li key={sec.id}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(sec.id)}
                        className="w-full rounded-full px-3.5 py-1.5 text-left text-xs font-medium transition-all duration-150"
                        style={{
                          background: active
                            ? 'color-mix(in srgb, var(--accent) 12%, var(--fill-1))'
                            : 'transparent',
                          border: active
                            ? '1px solid color-mix(in srgb, var(--accent) 55%, var(--border-strong))'
                            : '1px solid transparent',
                          color: active ? 'var(--ink)' : 'var(--muted)',
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {sec.title}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Back to top */}
            <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center gap-2 px-3 text-xs font-semibold transition-colors hover:text-[#FF5A00]"
                style={{ color: 'var(--muted)' }}
              >
                <ArrowUp className="size-3.5" />
                <span>Back to top</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="h-full w-80 max-w-[85vw] overflow-y-auto border-r p-5"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="glow-accent rounded-xl">
                  <LogoMark size={36} />
                </span>
                <span
                  className="script block text-xl leading-tight"
                  style={{ color: 'var(--accent)', textShadow: '0 0 18px var(--accent-glow)' }}
                >
                  OnPeer
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="inline-flex size-8 items-center justify-center rounded-lg border"
                style={{ borderColor: 'var(--border)' }}
              >
                <X className="size-4" />
              </button>
            </div>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Command-K Documentation Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
          onClick={closeSearch}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Search documentation"
            className="w-full max-w-xl overflow-hidden rounded-2xl border shadow-2xl"
            style={{
              background: 'var(--panel-solid)',
              borderColor: 'var(--border-strong)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center gap-3 border-b px-4 py-3"
              style={{ borderColor: 'var(--border)' }}
            >
              <Search className="size-4 shrink-0 text-[#FF5A00]" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search pages, escrow rules, CCTPx, smart contracts..."
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: 'var(--ink)' }}
              />
              <button
                type="button"
                onClick={closeSearch}
                className="rounded-md border px-2 py-0.5 text-[10px] font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                ESC
              </button>
            </div>

            <ul className="max-h-[360px] divide-y overflow-y-auto p-2" style={{ borderColor: 'var(--border)' }}>
              {searchResults.length === 0 ? (
                <li className="px-4 py-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  No matching documentation found for &ldquo;{searchQuery}&rdquo;.
                </li>
              ) : (
                searchResults.map((hit, idx) => (
                  <li key={`${hit.slug}-${hit.sectionId}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => goToPage(hit.slug, hit.sectionId)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--fill-2)]"
                    >
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#FF5A00]">
                          {hit.category} · {hit.pageTitle}
                        </p>
                        <p className="mt-0.5 truncate text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                          {hit.sectionTitle}
                        </p>
                      </div>
                      <ArrowRight className="size-3.5 shrink-0 opacity-60" />
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}

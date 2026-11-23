import { useState } from 'react'
import { Landmark } from 'lucide-react'
import {
  NetworkArbitrumOne,
  NetworkArc,
  NetworkAvalanche,
  NetworkBase,
  NetworkEthereum,
  NetworkOptimism,
  NetworkPolygon,
  TokenBTC,
  TokenETH,
  TokenEURC,
  TokenUSDC,
} from '@web3icons/react'
import type { PaymentMethod } from '@/lib/p2p'

/** Real brand marks live in /public/logos. Drop a file named after the method id to replace a fallback. */
const LOGO_FILE: Record<string, string> = {
  UPI: 'upi.png',
  IMPS: 'imps.png',
  Paytm: 'paytm.png',
  Raast: 'raast.png',
  JazzCash: 'jazzcash.png',
  Easypaisa: 'easypaisa.png',
  LankaQR: 'lankaqr.png',
  eSewa: 'esewa.webp',
  Khalti: 'khalti.ico',
  Rocket: 'rocket.png',
  mBoB: 'mbob.png',
  'BML MobilePay': 'bml.png',
}

/** Methods without a bundled mark get a clean monogram tile in the brand's own colour. */
const FALLBACK: Record<string, { bg: string; abbr: string }> = {
  bKash: { bg: '#E2136E', abbr: 'bK' },
  Nagad: { bg: '#F6921E', abbr: 'N' },
  'eZ Cash': { bg: '#E31E24', abbr: 'eZ' },
  ConnectIPS: { bg: '#00529B', abbr: 'IPS' },
  'M-Paisa': { bg: '#D0021B', abbr: 'M' },
}

export function MethodLogo({ name, size = 28 }: { name: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const file = LOGO_FILE[name]
  const radius = Math.round(size * 0.28)

  if (file && !broken) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden bg-white"
        style={{ width: size, height: size, borderRadius: radius, padding: Math.max(2, Math.round(size * 0.1)) }}
      >
        <img
          src={`/logos/${file}`}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-contain"
        />
      </span>
    )
  }

  const fb = FALLBACK[name]
  if (fb) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center font-bold text-white"
        style={{ width: size, height: size, borderRadius: radius, background: fb.bg, fontSize: size * 0.38, letterSpacing: '-0.02em' }}
      >
        {fb.abbr}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, borderRadius: radius, background: 'var(--fill-3)', color: 'var(--accent)' }}
    >
      <Landmark style={{ width: size * 0.55, height: size * 0.55 }} />
    </span>
  )
}

/** Logo plus name, for filters and pickers. */
export function MethodLabel({ method, size = 22 }: { method: Pick<PaymentMethod, 'name'>; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <MethodLogo name={method.name} size={size} />
      {method.name}
    </span>
  )
}

export function CountryFlag({ code, size = 28 }: { code: string; size?: number }) {
  return (
    <img
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      aria-hidden
      loading="lazy"
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, boxShadow: '0 0 0 1px rgba(255,255,255,0.18)' }}
    />
  )
}

/** Original blockchain network logo for Arc, Ethereum, Base, Arbitrum, Optimism, Avalanche, and Polygon. */
export function ChainLogo({ chain, size = 18 }: { chain: string; size?: number }) {
  switch (chain) {
    case 'Arc_Testnet':
    case 'arc':
      return <NetworkArc variant="branded" size={size} className="shrink-0" />
    case 'Ethereum_Sepolia':
    case 'ethereum':
      return <NetworkEthereum variant="branded" size={size} className="shrink-0" />
    case 'Base_Sepolia':
    case 'base':
      return <NetworkBase variant="branded" size={size} className="shrink-0" />
    case 'Arbitrum_Sepolia':
    case 'arbitrum':
      return <NetworkArbitrumOne variant="branded" size={size} className="shrink-0" />
    case 'Optimism_Sepolia':
    case 'optimism':
      return <NetworkOptimism variant="branded" size={size} className="shrink-0" />
    case 'Avalanche_Fuji':
    case 'avalanche':
      return <NetworkAvalanche variant="branded" size={size} className="shrink-0" />
    case 'Polygon_Amoy_Testnet':
    case 'polygon':
      return <NetworkPolygon variant="branded" size={size} className="shrink-0" />
    default:
      return <NetworkArc variant="branded" size={size} className="shrink-0" />
  }
}

/** Original branded coin logo for USDC, EURC, cirBTC, and WETH. */
export function CoinLogo({
  symbol,
  size = 18,
}: {
  symbol: 'USDC' | 'EURC' | 'cirBTC' | 'WETH' | 'wETH' | string
  size?: number
}) {
  const s = symbol.toUpperCase()
  if (s === 'EURC') return <TokenEURC variant="branded" size={size} className="shrink-0" />
  if (s === 'CIRBTC' || s === 'WBTC' || s === 'BTC') {
    return <TokenBTC variant="branded" size={size} className="shrink-0" />
  }
  if (s === 'WETH' || s === 'ETH') {
    return <TokenETH variant="branded" size={size} className="shrink-0" />
  }
  return <TokenUSDC variant="branded" size={size} className="shrink-0" />
}

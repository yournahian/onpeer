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

/** 512×512 regional payment provider marks stored in /public/logos. */
const LOGO_FILE: Record<string, string> = {
  // India
  UPI: 'upi.png',
  PhonePe: 'phonepe.png',
  Paytm: 'paytm.png',
  BHIM: 'bhim.png',
  // Pakistan
  Easypaisa: 'easypaisa.png',
  JazzCash: 'jazzcash.png',
  NayaPay: 'nayapay.png',
  SadaPay: 'sadapay.png',
  // Bangladesh
  bKash: 'bkash.png',
  Nagad: 'nagad.png',
  Rocket: 'rocket.png',
  upay: 'upay.png',
  // Sri Lanka
  'eZ Cash': 'ezcash.png',
  FriMi: 'frimi.png',
  Genie: 'genie.png',
  mCash: 'mcash.png',
  // Nepal
  eSewa: 'esewa.png',
  Khalti: 'khalti.png',
  'IME Pay': 'imepay.png',
  'Namaste Pay': 'namastepay.png',
  // Bhutan
  mBoB: 'mbob.png',
  goBOB: 'gobob.png',
  'Digital Kidu': 'digitalkidu.png',
  eTeeru: 'eteeru.png',
  MyPay: 'mypay.png',
  // Maldives
  'BML MobilePay': 'bml.png',
  'BML Mobile Banking': 'bml.png',
  DhiraaguPay: 'dhiraagupay.png',
  Favara: 'favara.png',
  'm-Faisaa': 'mfaisaa.png',
  // Afghanistan
  'M-Paisa': 'mpaisa.png',
  HesabPay: 'hesabpay.png',
  'M-Hawala': 'mhawala.png',
  'My-Money': 'mymoney.png',
}

/** Clean monogram tiles for network clearing rails without a dedicated app logo. */
const FALLBACK: Record<string, { bg: string; abbr: string }> = {
  IMPS: { bg: '#0F4C81', abbr: 'IMPS' },
  Raast: { bg: '#01693A', abbr: 'RST' },
  LankaQR: { bg: '#8D2029', abbr: 'LQR' },
  ConnectIPS: { bg: '#00529B', abbr: 'IPS' },
}

export function MethodLogo({ name, size = 28 }: { name: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const file = LOGO_FILE[name]
  const radius = Math.round(size * 0.26)

  if (file && !broken) {
    return (
      <span
        title={name}
        className="inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-black/10"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          padding: 1,
        }}
      >
        <img
          src={`/logos/${file}`}
          alt={name}
          decoding="async"
          onError={() => setBroken(true)}
          className="size-full rounded-[inherit] object-contain"
        />
      </span>
    )
  }

  const fb = FALLBACK[name]
  if (fb) {
    return (
      <span
        title={name}
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center font-bold text-white"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: fb.bg,
          fontSize: Math.max(8, Math.round(size * (fb.abbr.length >= 4 ? 0.28 : 0.34))),
          letterSpacing: '-0.02em',
        }}
      >
        {fb.abbr}
      </span>
    )
  }

  return (
    <span
      title={name}
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
      decoding="async"
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

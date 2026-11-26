import { defineChain } from 'viem'
import { arcTestnet } from 'viem/chains'

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.mainnet.arc.io'],
      webSocket: ['wss://rpc.mainnet.arc.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.arc.io',
    },
  },
  testnet: false,
})

function detectTestnet(): boolean {
  const envNet = (import.meta.env.VITE_ARC_NETWORK as string | undefined)?.trim().toLowerCase()
  if (envNet === 'testnet') return true
  if (envNet === 'mainnet') return false
  if (typeof window !== 'undefined' && window.location.hostname.toLowerCase().startsWith('testnet.')) {
    return true
  }
  return false
}

/** True when running on `testnet.onpeer.xyz` or with `VITE_ARC_NETWORK=testnet`; false (Arc Mainnet) by default. */
export const IS_TESTNET = detectTestnet()
export const ACTIVE_ARC_CHAIN = IS_TESTNET ? arcTestnet : arcMainnet
export const ACTIVE_CHAIN_ID = ACTIVE_ARC_CHAIN.id
export const ARC_KIT_CHAIN = (IS_TESTNET ? 'Arc_Testnet' : 'Arc') as 'Arc_Testnet' | 'Arc'
export const ARC_NETWORK_LABEL = IS_TESTNET ? 'Arc Testnet' : 'Arc'

/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import {
  arbitrumSepolia,
  arcTestnet,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
  sepolia,
} from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

// Arc Testnet first (P2P and swap run here); the others are bridge sources and destinations.
export const supportedChains = [
  arcTestnet,
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  avalancheFuji,
  polygonAmoy,
] as const

export const config = createConfig({
  chains: [...supportedChains, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [optimismSepolia.id]: http(),
    [avalancheFuji.id]: http(),
    [polygonAmoy.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})

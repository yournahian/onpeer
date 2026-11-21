/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { fallback, http, createConfig } from 'wagmi'
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
    [arcTestnet.id]: fallback([
      http('https://rpc.testnet.arc.network', { batch: { wait: 50 }, retryCount: 1, timeout: 10_000 }),
      http('https://rpc.testnet.arc.io', { batch: { wait: 50 }, retryCount: 1, timeout: 10_000 }),
      http('https://rpc.blockdaemon.testnet.arc.io', { batch: { wait: 50 }, retryCount: 1, timeout: 10_000 }),
    ]),
    [sepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [baseSepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [arbitrumSepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [optimismSepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [avalancheFuji.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [polygonAmoy.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})

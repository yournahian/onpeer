/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { fallback, http, createConfig } from 'wagmi'
import {
  arbitrum,
  arbitrumSepolia,
  arcTestnet,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from 'viem/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { ACTIVE_ARC_CHAIN, IS_TESTNET, arcMainnet } from '@/lib/network'
import { registerChain } from './tracing'

// Pre-register active Arc chain RPC URL so trace events show the correct chain immediately
registerChain(ACTIVE_ARC_CHAIN.id, ACTIVE_ARC_CHAIN.rpcUrls.default.http[0])

// Active Arc chain first (P2P and swap run here); the others are bridge sources and destinations.
export const supportedChains = IS_TESTNET
  ? ([
      arcTestnet,
      sepolia,
      baseSepolia,
      arbitrumSepolia,
      optimismSepolia,
      avalancheFuji,
      polygonAmoy,
    ] as const)
  : ([arcMainnet, mainnet, base, arbitrum, optimism, avalanche, polygon] as const)

const wcProjectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '').trim()

const connectors = wcProjectId
  ? [
      injected(),
      walletConnect({
        projectId: wcProjectId,
        showQrModal: false,
        metadata: {
          name: 'OnPeer',
          description: 'Non-Custodial P2P Crypto, Swap & Bridge for South Asia on Arc',
          url: IS_TESTNET ? 'https://testnet.onpeer.xyz' : 'https://app.onpeer.xyz',
          icons: ['https://onpeer.xyz/brand/icon-512.png'],
        },
      }),
    ]
  : [injected()]

export const config = createConfig({
  chains: [
    ACTIVE_ARC_CHAIN,
    arcMainnet,
    arcTestnet,
    mainnet,
    base,
    arbitrum,
    optimism,
    avalanche,
    polygon,
    sepolia,
    baseSepolia,
    arbitrumSepolia,
    optimismSepolia,
    avalancheFuji,
    polygonAmoy,
  ],
  connectors,
  transports: {
    [arcMainnet.id]: http('https://rpc.mainnet.arc.io', { batch: { wait: 50 }, retryCount: 2, timeout: 10_000 }),
    [arcTestnet.id]: fallback([
      http('https://rpc.testnet.arc.network', { batch: { wait: 50 }, retryCount: 1, timeout: 10_000 }),
      http('https://rpc.testnet.arc.io', { batch: { wait: 50 }, retryCount: 1, timeout: 10_000 }),
      http('https://rpc.blockdaemon.testnet.arc.io', { batch: { wait: 50 }, retryCount: 1, timeout: 10_000 }),
    ]),
    [mainnet.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [base.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [arbitrum.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [optimism.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [avalanche.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [polygon.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [sepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [baseSepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [arbitrumSepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [optimismSepolia.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [avalancheFuji.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
    [polygonAmoy.id]: http(undefined, { batch: { wait: 50 }, retryCount: 2 }),
  },
})

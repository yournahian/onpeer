import { AppKit, getErrorMessage, isUserCancellationError } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { Connector } from 'wagmi'
import type { EIP1193Provider } from 'viem'

export const SANDBOX_ONRAMP_WIDGET_BASE_URL = 'https://onramp-sandbox.arc.io'

/** Shared kit instance for Swap and Bridge — never throws at module load if onramp vars are unset. */
export const appKit = new AppKit()

let cachedSandboxOnrampKit: AppKit | null = null

export type SandboxOnrampKitResult =
  | { ok: true; kit: AppKit; widgetBaseUrl: string }
  | { ok: false; error: string }

/**
 * Lazily validates `VITE_ONRAMP_WIDGET_BASE_URL` ONLY when `/buy` mounts, so `/swap` and `/bridge`
 * keep working even when onramp env vars are missing. Never falls back to production URLs.
 */
export function getSandboxOnrampKit(): SandboxOnrampKitResult {
  const raw = (import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '')
  if (!raw) {
    return {
      ok: false,
      error: 'Sandbox checkout is not configured in this build right now.',
    }
  }
  if (raw !== SANDBOX_ONRAMP_WIDGET_BASE_URL) {
    return {
      ok: false,
      error: 'OnPeer Buy USDC is restricted to Circle Onramp Sandbox only.',
    }
  }
  if (!cachedSandboxOnrampKit) {
    cachedSandboxOnrampKit = new AppKit({
      onramp: { widgetBaseUrl: SANDBOX_ONRAMP_WIDGET_BASE_URL },
    })
  }
  return { ok: true, kit: cachedSandboxOnrampKit, widgetBaseUrl: SANDBOX_ONRAMP_WIDGET_BASE_URL }
}

/** Builds a kit adapter from the connected browser wallet. Switch the wallet to the source chain first. */
export async function adapterFromConnector(connector: Connector) {
  const provider = (await connector.getProvider()) as EIP1193Provider
  return createViemAdapterFromProvider({ provider })
}

/** Friendly message for a kit error, or null when the user simply cancelled in their wallet. */
export function kitErrorMessage(err: unknown): string | null {
  if (isUserCancellationError(err)) return null
  const raw = getErrorMessage(err)
  const text = typeof raw === 'string' && raw ? raw : 'Something went wrong. Please try again.'
  return text.length > 220 ? `${text.slice(0, 220)}...` : text
}

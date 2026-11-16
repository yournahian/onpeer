import { AppKit, getErrorMessage, isUserCancellationError } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { Connector } from 'wagmi'
import type { EIP1193Provider } from 'viem'

/** One shared kit instance for swap and bridge. */
export const appKit = new AppKit()

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

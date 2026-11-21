export interface OffRampQuoteRequest {
  country: string
  fiatCurrency: string
  usdcAmount: string
}

export interface OffRampQuote {
  providerId: string
  fiatCurrency: string
  estimatedFiatAmount: string
  feeUsdc: string
  expiresAt: string
}

export interface OffRampSessionRequest {
  country: string
  fiatCurrency: string
  usdcAmount: string
  walletAddress: `0x${string}`
}

export interface OffRampSession {
  providerId: string
  sessionId: string
  launchUrl: string
  expiresAt: string
}

/**
 * Minimal adapter contract reserved for verified third-party fiat off-ramp integrations.
 * No third-party off-ramp provider is enabled in Phase 3; users cash out via OnPeer P2P escrow.
 */
export interface OffRampProvider {
  readonly id: string
  readonly displayName: string
  supports(country: string): boolean
  quote(params: OffRampQuoteRequest): Promise<OffRampQuote>
  createSession(params: OffRampSessionRequest): Promise<OffRampSession>
}

/** Empty registry — zero providers, zero API keys, and zero network calls until verified. */
export const OFFRAMP_PROVIDERS: readonly OffRampProvider[] = []

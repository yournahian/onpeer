import { useAccount } from 'wagmi'
import { useMyAccount, useNow, usePaused, usePrivacySwitches, useVerification } from '@/hooks/useEscrow'
import { formatDuration, formatUsdcAmount } from '@/lib/p2p'

/** Why the connected wallet cannot open new ads or orders right now, or null when it can. */
export function useEligibility(): {
  blocked: string | null
  account: ReturnType<typeof useMyAccount>
  kyc: ReturnType<typeof useVerification>
  kycRequired: boolean
} {
  const { address } = useAccount()
  const account = useMyAccount()
  const paused = usePaused()
  const { kycRequired } = usePrivacySwitches()
  const kyc = useVerification(address)
  const now = useNow()

  let blocked: string | null = null
  if (paused) blocked = 'New ads and orders are paused by the marketplace operator. Existing orders still work.'
  else if (account) {
    if (account.restricted || account.disputeLimitReached)
      blocked = 'This account is restricted from opening new trades. Existing orders can still be finished.'
    else if (account.totalDebt > 0n)
      blocked = `Unpaid dispute bond of ${formatUsdcAmount(account.totalDebt)} USDC. Repay it on the Trust & margin tab to resume trading.`
    else if (Number(account.bannedUntil) > now)
      blocked = `Cooldown after repeated cancellations. You can trade again in ${formatDuration(Number(account.bannedUntil) - now)}.`
    else if (kycRequired && !kyc.verified)
      blocked = 'Active KYC verification is required to post ads or open orders. Existing orders and withdrawals still work.'
  }
  return { blocked, account, kyc, kycRequired }
}

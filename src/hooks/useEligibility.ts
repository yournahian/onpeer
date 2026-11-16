import { useMyAccount, useNow, usePaused } from '@/hooks/useEscrow'
import { formatDuration } from '@/lib/p2p'

const MAX_DISPUTES_LOST = 3

/** Why the connected wallet cannot open new ads or orders right now, or null when it can. */
export function useEligibility(): { blocked: string | null; account: ReturnType<typeof useMyAccount> } {
  const account = useMyAccount()
  const paused = usePaused()
  const now = useNow()

  let blocked: string | null = null
  if (paused) blocked = 'New ads and orders are paused by the marketplace operator. Existing orders still work.'
  else if (account) {
    if (account.restricted || account.disputesLost >= MAX_DISPUTES_LOST)
      blocked = 'This account is restricted from opening new trades. Existing orders can still be finished.'
    else if (Number(account.bannedUntil) > now)
      blocked = `Cooldown after repeated cancellations. You can trade again in ${formatDuration(Number(account.bannedUntil) - now)}.`
  }
  return { blocked, account }
}

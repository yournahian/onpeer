import { useCallback, useEffect, useState } from 'react'
import { apiFetch, BackendApiError } from '@/lib/api'

export interface DisputeFiling {
  id: string
  orderId: string
  filedBy: string
  reasonCode: string
  statement: string
  evidenceBlobIds: string[]
  status: string
  filedAt: string
}

interface GetFilingsResult {
  orderId: string
  filings: DisputeFiling[]
}

interface AdminQueueResult {
  filings: DisputeFiling[]
  hasMore: boolean
}

// ---- useDisputeFilings: GET /api/orders/:id/disputes ----
export function useDisputeFilings(orderId: bigint | undefined) {
  const [filings, setFilings] = useState<DisputeFiling[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orderId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await apiFetch<GetFilingsResult>(`/orders/${orderId.toString()}/disputes`)
      setFilings(res.filings)
    } catch (err) {
      setError(err instanceof BackendApiError ? err.message : 'Failed to load filings.')
    } finally {
      setIsLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  return { filings, isLoading, error, reload: load }
}

// ---- useFileDispute: POST /api/orders/:id/disputes ----
export function useFileDispute(orderId: bigint | undefined) {
  const [filing, setFiling] = useState<{ id: string; status: string } | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const file = useCallback(
    async (params: {
      reasonCode: string
      statement: string
      evidenceBlobIds?: string[]
    }) => {
      if (!orderId) return
      setIsPending(true)
      setError(null)
      try {
        const res = await apiFetch<{ id: string; status: string }>(
          `/orders/${orderId.toString()}/disputes`,
          {
            method: 'POST',
            body: {
              reasonCode: params.reasonCode,
              statement: params.statement,
              evidenceBlobIds: params.evidenceBlobIds ?? [],
            },
          },
        )
        setFiling(res)
        return res
      } catch (err) {
        const msg = err instanceof BackendApiError ? err.message : 'Failed to file dispute.'
        setError(msg)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [orderId],
  )

  return { file, filing, isPending, error }
}

// ---- useAdminDisputeQueue: GET /api/admin/disputes ----
export function useAdminDisputeQueue(statusFilter: 'open' | 'taken' | 'resolved' = 'open') {
  const [filings, setFilings] = useState<DisputeFiling[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await apiFetch<AdminQueueResult>(`/admin/disputes?status=${statusFilter}&limit=50`)
      setFilings(res.filings)
      setHasMore(res.hasMore)
    } catch (err) {
      setError(err instanceof BackendApiError ? err.message : 'Failed to load dispute queue.')
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  return { filings, hasMore, isLoading, error, reload: load }
}

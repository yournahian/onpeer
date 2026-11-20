import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { apiFetch, useBackendSession } from '@/lib/api'

interface CronJobStatus {
  jobName: string
  lastRunAt: string
  lastOkAt: string | null
  lastError: string | null
  lastErrorAt: string | null
}

interface AdminHealthPayload {
  jobs: CronJobStatus[]
  outbox: Record<string, number>
  onchainJobs: Record<string, number>
  cursors: Array<{ name: string; last_block: string; updated_at: string }>
}

export function JobHealthCard() {
  const session = useBackendSession()
  const [data, setData] = useState<AdminHealthPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch<AdminHealthPayload>('/admin/health')
      setData(res)
    } catch {
      setErr('Sign in with an admin P2P session to inspect scheduled job health.')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  return (
    <section className="glass rounded-3xl p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4" /> Scheduled jobs &amp; queue health
        </h2>
        <button
          type="button"
          disabled={loading || !session}
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--fill-2)', color: 'var(--muted)' }}
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {!session ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          Sign in on /p2p (or Filings tab) to view cron job health, email outbox, and chain cursor status.
        </p>
      ) : err ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{err}</p>
      ) : !data ? (
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Loading job health...</p>
      ) : (
        <div className="mt-3 space-y-3 text-xs">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.jobs.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No scheduled runs recorded yet.</p>
            ) : (
              data.jobs.map((j) => (
                <div
                  key={j.jobName}
                  className="rounded-xl px-3 py-2"
                  style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono font-semibold">{j.jobName}</span>
                    {j.lastError ? (
                      <AlertTriangle className="size-3.5" style={{ color: 'var(--danger)' }} />
                    ) : (
                      <CheckCircle2 className="size-3.5" style={{ color: 'var(--success)' }} />
                    )}
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--subtle)' }}>
                    Last run: {new Date(j.lastRunAt).toLocaleTimeString()}
                  </p>
                  {j.lastError && (
                    <p className="mono mt-0.5 text-[11px]" style={{ color: 'var(--danger)' }}>
                      Error: {j.lastError}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-4 pt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
            <span>
              Outbox: <strong>{data.outbox.pending ?? 0}</strong> pending ·{' '}
              <strong>{data.outbox.sent ?? 0}</strong> sent ·{' '}
              <strong>{data.outbox.failed ?? 0}</strong> failed
            </span>
            <span>
              Verifier jobs: <strong>{data.onchainJobs.pending ?? 0}</strong> pending ·{' '}
              <strong>{data.onchainJobs.done ?? 0}</strong> done ·{' '}
              <strong>{data.onchainJobs.failed ?? 0}</strong> failed
            </span>
            {data.cursors.map((c) => (
              <span key={c.name} className="mono">
                Cursor ({c.name}): #{c.last_block}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

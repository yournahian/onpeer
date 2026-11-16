import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AppLink } from '@/components/AppLink'

type State = { error: Error | null }

/** Keeps one broken page from blanking the whole app, and says what went wrong. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; /** Rendered instead of the error card (use null for optional extras such as the assistant). */ fallback?: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label ?? 'page'}] crashed:`, error.message, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="glass w-full rounded-3xl p-8">
          <h2 className="display text-2xl font-bold">This page hit a problem</h2>
          <p className="mt-2 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            {this.state.error.message || 'Something went wrong while loading.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="btn-shine min-h-11 rounded-xl px-5 text-sm font-semibold"
              style={{ background: 'var(--accent-bg)', color: 'var(--on-accent)' }}
            >
              Reload
            </button>
            <AppLink
              to="/"
              className="inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold"
              style={{ border: '1px solid var(--border)' }}
            >
              Back to home
            </AppLink>
          </div>
        </div>
      </div>
    )
  }
}

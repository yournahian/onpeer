import { motion } from 'framer-motion'
import { TokenUSDC } from '@web3icons/react'

export type RouteState = 'idle' | 'bridging' | 'done' | 'failed'

/**
 * Source and destination with a line between them. The line only animates while a bridge is
 * really running, turns solid green when it finishes, and red if it stopped.
 */
export function RouteVisual({ from, to, state }: { from: string; to: string; state: RouteState }) {
  const color = state === 'done' ? 'var(--success)' : state === 'failed' ? 'var(--danger)' : 'var(--accent)'
  return (
    <div className="flex items-center gap-2 px-1" aria-hidden>
      <Node label={from} active />
      <svg viewBox="0 0 200 40" className="h-10 min-w-0 flex-1 overflow-visible" preserveAspectRatio="none">
        <path d="M2 20 C 60 4, 140 36, 198 20" fill="none" stroke="var(--fill-3)" strokeWidth="2" strokeLinecap="round" />
        <motion.path
          d="M2 20 C 60 4, 140 36, 198 20"
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          className={state === 'bridging' ? 'route-flow' : undefined}
          initial={false}
          animate={{ pathLength: state === 'done' ? 1 : state === 'idle' ? 0.001 : 1, opacity: state === 'idle' ? 0 : 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
        {state === 'bridging' && (
          <circle r="4" fill="var(--accent-hover)">
            <animateMotion dur="1.6s" repeatCount="indefinite" path="M2 20 C 60 4, 140 36, 198 20" />
          </circle>
        )}
      </svg>
      <Node label={to} active={state === 'done'} />
    </div>
  )
}

function Node({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex w-[84px] shrink-0 flex-col items-center gap-1.5 text-center">
      <span
        className="glass flex size-11 items-center justify-center rounded-full transition-shadow duration-500"
        style={active ? { boxShadow: '0 0 28px -4px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.1)' } : undefined}
      >
        <TokenUSDC variant="branded" size={24} />
      </span>
      <span className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
    </div>
  )
}

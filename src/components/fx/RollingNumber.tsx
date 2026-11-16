import { AnimatePresence, motion } from 'framer-motion'

/**
 * Renders a formatted number where each character that changes rolls in from below.
 * Only use it for values that really change (balances, counters), never for decoration.
 */
export function RollingNumber({ value, className = '' }: { value: string; className?: string }) {
  const chars = value.split('')
  return (
    <span className={`inline-flex tabular-nums ${className}`} aria-label={value}>
      {chars.map((ch, i) => (
        <span key={`${chars.length - i}`} className="relative inline-block overflow-hidden" aria-hidden>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ch}
              className="inline-block"
              initial={{ y: '70%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '-70%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              {ch === ' ' ? '\u00a0' : ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  )
}

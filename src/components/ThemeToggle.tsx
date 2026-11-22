import { useId } from 'react'
import { motion } from 'framer-motion'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePref } from '@/lib/theme'

const OPTIONS: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
  { id: 'light', label: 'Light theme', Icon: Sun },
  { id: 'system', label: 'System theme', Icon: Monitor },
  { id: 'dark', label: 'Dark theme', Icon: Moon },
]

/** Three-way theme switch: light, system, dark. */
export function ThemeToggle({
  className = '',
  compact = false,
  size = 'md',
}: {
  className?: string
  compact?: boolean
  size?: 'sm' | 'md'
}) {
  const { pref, setPref } = useTheme()
  const pillId = useId()
  if (compact) {
    const i = OPTIONS.findIndex((o) => o.id === pref)
    const next = OPTIONS[(i + 1) % OPTIONS.length]
    const Current = OPTIONS[i].Icon
    return (
      <button
        onClick={() => setPref(next.id)}
        aria-label={`Theme: ${pref}. Switch to ${next.id}`}
        title={`Theme: ${pref}`}
        className={`flex size-10 items-center justify-center rounded-full ${className}`}
        style={{ background: 'var(--fill-2)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
      >
        <motion.span key={pref} initial={{ rotate: -80, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} className="flex">
          <Current className="size-4" />
        </motion.span>
      </button>
    )
  }
  const btnSize = size === 'sm' ? 'size-7' : 'size-8'
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4'
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`relative inline-flex rounded-full p-0.5 ${className}`}
      style={{ background: 'var(--fill-2)', border: '1px solid var(--border)' }}
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = pref === id
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setPref(id)}
            className={`relative flex ${btnSize} items-center justify-center rounded-full transition-colors`}
            style={{ color: active ? 'var(--on-accent)' : 'var(--muted)' }}
          >
            {active && (
              <motion.span
                layoutId={pillId}
                className="absolute inset-0 rounded-full"
                style={{ background: 'var(--accent-bg)', boxShadow: '0 4px 14px -4px var(--accent-glow)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            )}
            <Icon className={`relative ${iconSize}`} />
          </button>
        )
      })}
    </div>
  )
}

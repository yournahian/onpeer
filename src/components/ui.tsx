import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { STATUS_META, type StatusTone } from '@/lib/p2p'

type Variant = 'primary' | 'ghost' | 'buy' | 'sell' | 'danger'

const variantStyle: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--accent-bg)', color: 'var(--on-accent)' },
  ghost: { background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border)' },
  buy: { background: 'var(--success)', color: 'var(--on-accent)' },
  sell: { background: 'var(--danger)', color: 'var(--on-accent)' },
  danger: { background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' },
}

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{ ...variantStyle[variant], ...style }}
      className={`btn-shine inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-all duration-200 hover:-translate-y-px hover:brightness-110 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${variant === 'primary' ? 'glow-accent' : ''} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
            style={{
              background: 'var(--panel-bg)',
              border: '1px solid var(--border)',
              backdropFilter: 'blur(40px) saturate(180%)',
            }}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-5 pb-2 pt-5">
              <h2 className="display text-xl font-semibold">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--fill-3)]"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="overflow-y-auto px-5 pb-6 pt-2">{children}</div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const toneColor: Record<StatusTone, { fg: string; bg: string }> = {
  info: { fg: 'var(--accent)', bg: 'var(--fill-3)' },
  warn: { fg: 'var(--warn)', bg: 'rgba(232,196,109,0.14)' },
  success: { fg: 'var(--success)', bg: 'rgba(141,216,159,0.14)' },
  danger: { fg: 'var(--danger)', bg: 'rgba(232,109,122,0.14)' },
  neutral: { fg: 'var(--subtle)', bg: 'rgba(148,163,184,0.14)' },
}

export function StatusBadge({ status }: { status: number }) {
  const meta = STATUS_META[status] ?? STATUS_META[0]
  const c = toneColor[meta.tone]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ color: c.fg, background: c.bg }}
    >
      {(meta.tone === 'warn' || meta.tone === 'info' || meta.tone === 'danger') && <span className="live-dot" />}
      {meta.label}
    </span>
  )
}

export function Avatar({ address, size = 36 }: { address: string; size?: number }) {
  const hue = parseInt(address.slice(2, 8), 16) % 360
  return (
    <span
      className="display flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 45% 32%)`,
        color: `hsl(${hue} 80% 88%)`,
      }}
    >
      {address.slice(2, 4).toUpperCase()}
    </span>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
      className="inline-flex items-center gap-1 text-xs font-semibold"
      style={{ color: 'var(--accent)' }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? 'Copied' : label}
    </button>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="min-h-9 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-px active:scale-95"
      style={{
        background: active ? 'var(--accent-bg)' : 'var(--surface)',
        color: active ? 'var(--on-accent)' : 'var(--muted)',
        border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--subtle)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs" style={{ color: 'var(--subtle)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

export const inputClass =
  'inner w-full rounded-xl bg-transparent px-3.5 py-3 text-base tabular-nums outline-none focus:border-[var(--accent)]'

export function Empty({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <motion.div
      className="glass rounded-3xl px-6 py-12 text-center"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="display text-lg font-semibold">{title}</p>
      {body && (
        <p className="mx-auto mt-2 max-w-sm text-pretty text-sm" style={{ color: 'var(--subtle)' }}>
          {body}
        </p>
      )}
    </motion.div>
  )
}

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="glass shimmer h-24 rounded-2xl" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  )
}

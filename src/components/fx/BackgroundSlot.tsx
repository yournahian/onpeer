import { useState, type CSSProperties, type ReactNode } from 'react'
import { motion, type MotionStyle } from 'framer-motion'
import { ImageIcon } from 'lucide-react'

/**
 * A background that is ready for your own image.
 *
 * It tries each file in `files` (served from /public) in order. If none exists it shows a clearly
 * marked placeholder instead, so an empty slot is obvious. Drop a file with one of the names into
 * `public/hero` and it appears; nothing else needs to change. The text-legibility `overlay` is only
 * drawn on top of a real image, never on the placeholder.
 */
export function BackgroundSlot({
  files,
  title,
  size,
  overlay,
  layerClassName = 'absolute inset-0',
  layerStyle,
  imgClassName = 'size-full object-cover',
  imgStyle,
}: {
  files: string[]
  title: string
  /** Suggested pixel size, shown in the placeholder. */
  size: string
  overlay?: ReactNode
  layerClassName?: string
  layerStyle?: MotionStyle
  imgClassName?: string
  imgStyle?: CSSProperties
}) {
  const [i, setI] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const missing = i >= files.length

  if (missing) {
    return (
      <div aria-label={`${title} placeholder`} className="absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              'repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 14px, transparent 14px 28px), linear-gradient(180deg, #170a30, #0a0414)',
          }}
        />
        <div className="absolute inset-3 rounded-[1.25rem] border-2 border-dashed sm:inset-5" style={{ borderColor: 'rgba(232,121,249,0.4)' }} />
        <div className="absolute inset-x-0 top-[22%] flex justify-center px-6">
          <div
            className="flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-left backdrop-blur"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', color: '#f5e9ff' }}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(232,121,249,0.25)' }}>
              <ImageIcon className="size-5" />
            </span>
            <span className="text-xs leading-snug">
              <span className="block text-sm font-bold">{title} placeholder</span>
              Add an image at <span className="mono">public/hero/{files[0].split('/').pop()}</span>
              <span className="block opacity-70">Suggested size {size}</span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(files[i])

  return (
    <>
      <motion.div className={layerClassName} style={layerStyle}>
        {isVideo ? (
          <video
            key={files[i]}
            src={files[i]}
            autoPlay
            loop
            muted
            playsInline
            aria-hidden
            className={imgClassName}
            style={imgStyle}
            onLoadedData={() => setLoaded(true)}
            onError={() => setI((n) => n + 1)}
          />
        ) : (
          <img
            key={files[i]}
            src={files[i]}
            alt=""
            draggable={false}
            className={imgClassName}
            style={imgStyle}
            onLoad={() => setLoaded(true)}
            onError={() => setI((n) => n + 1)}
          />
        )}
      </motion.div>
      {loaded && overlay}
    </>
  )
}

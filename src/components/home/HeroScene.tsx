const SYMBOLS = ['₹', '৳', 'Rs', '$', '؋', 'Rf', 'Nu', '$', '₹', '৳', 'Rs', '$']

/** Floating currency marks that drift up across the whole stage. */
export function RisingSymbols() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {SYMBOLS.map((s, i) => (
        <span
          key={i}
          className="rise-symbol display absolute bottom-[-30px] font-bold"
          style={{
            left: `${6 + ((i * 83) % 90)}%`,
            fontSize: `${16 + (i % 4) * 7}px`,
            color: i % 3 === 0 ? '#67e8f9' : i % 3 === 1 ? '#f0abfc' : '#c084fc',
            textShadow: '0 0 14px currentColor',
            animationDelay: `${(i * 0.95) % 11}s`,
            animationDuration: `${9 + (i % 5)}s`,
          }}
        >
          {s}
        </span>
      ))}
    </div>
  )
}

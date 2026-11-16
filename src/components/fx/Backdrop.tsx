/** Soft ambient canvas behind every page: three slow aurora blooms, a faded grid and film grain. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="aurora aurora-c" />
      <div className="grid-fade" />
      <div className="grain" />
    </div>
  )
}

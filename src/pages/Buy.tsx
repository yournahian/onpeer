import { SiteBar } from '@/components/SiteBar'
import { BuyUsdcPanel } from '@/components/BuyUsdcPanel'

export default function BuyPage() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteBar fixed />
      <div className="relative z-10 flex flex-1 w-full flex-col items-center justify-center overflow-hidden px-4 py-3 sm:py-4">
        <div className="relative z-20 flex w-full justify-center">
          <BuyUsdcPanel />
        </div>
      </div>
    </div>
  )
}

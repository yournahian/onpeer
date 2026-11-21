import { SiteBar } from '@/components/SiteBar'
import { RibbonBackdrop } from '@/components/fx/RibbonBackdrop'
import { BuyUsdcPanel } from '@/components/BuyUsdcPanel'

export default function BuyPage() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <SiteBar />
      <div className="relative flex flex-1 w-full flex-col items-center justify-center overflow-hidden px-4 py-3 sm:py-4">
        <RibbonBackdrop />
        <div className="relative z-20 flex w-full justify-center">
          <BuyUsdcPanel />
        </div>
      </div>
    </div>
  )
}

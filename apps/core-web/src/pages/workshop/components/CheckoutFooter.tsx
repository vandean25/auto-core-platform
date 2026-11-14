import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency } from '@/lib/utils'
import { useStickyBottomChromeHeight } from '@/components/layout/use-sticky-bottom-chrome-height'
import type { CheckoutFooterTotalKind } from '@/lib/workshop-checkout-billing'
import { CheckoutSummary, type CheckoutSummaryProps } from "./CheckoutSummary";

export interface CheckoutFooterProps extends CheckoutSummaryProps {
  checkoutFooterTotal: number;
  checkoutFooterTotalKind?: CheckoutFooterTotalKind;
  isCheckoutOpen: boolean;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  onClose: () => void;
}

export function CheckoutFooter({
  checkoutFooterTotal,
  checkoutFooterTotalKind = 'net',
  isCheckoutOpen,
  primaryActionLabel,
  onPrimaryAction,
  onClose,
  ...summaryProps
}: CheckoutFooterProps) {
  const { t } = useTranslation('workshop')
  const stickyChromeRef = useStickyBottomChromeHeight<HTMLDivElement>()

  return (
    <section
      data-sticky-bottom-chrome=""
      className={cn(
        "sticky bottom-[var(--phone-nav-h)] z-20 -mx-4 bg-background/95 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur md:-mx-6",
        isCheckoutOpen &&
          "max-md:max-h-[calc(100dvh-var(--phone-nav-h))] max-md:overflow-y-auto",
      )}
    >
      <div
        ref={stickyChromeRef}
        data-sticky-bottom-chrome-measure=""
        className="border-t px-4 pt-3 pb-4 md:px-6 md:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(
                checkoutFooterTotalKind === 'gross'
                  ? 'checkout.grossTotal'
                  : 'checkout.netTotal',
              )}
            </div>
            <div className="whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums">
              {formatCurrency(checkoutFooterTotal)}
            </div>
          </div>
          <Button className="max-md:min-h-11" onClick={onPrimaryAction}>
            {primaryActionLabel}
          </Button>
        </div>
      </div>

      {isCheckoutOpen && (
        <div className="border-t px-4 pb-4 pt-4 md:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("checkout.title")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("checkout.description")}
              </p>
            </div>
            <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={onClose}>
              <X className="mr-1.5 h-4 w-4" />
              {t("checkout.close")}
            </Button>
          </div>
          <CheckoutSummary {...summaryProps} />
        </div>
      )}
    </section>
  );
}

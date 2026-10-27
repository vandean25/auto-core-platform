import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency } from '@/lib/utils'
import { CheckoutSummary, type CheckoutSummaryProps } from "./CheckoutSummary";

export interface CheckoutFooterProps extends CheckoutSummaryProps {
  checkoutFooterTotal: number;
  isCheckoutOpen: boolean;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  onClose: () => void;
}

export function CheckoutFooter({
  checkoutFooterTotal,
  isCheckoutOpen,
  primaryActionLabel,
  onPrimaryAction,
  onClose,
  ...summaryProps
}: CheckoutFooterProps) {
  const { t } = useTranslation('workshop')

  return (
    <section className={cn("sticky bottom-[var(--phone-nav-h)] z-20 -mx-4 border-t bg-background/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur md:-mx-6 md:px-6", isCheckoutOpen && "max-md:max-h-[calc(100dvh-var(--phone-nav-h))] max-md:overflow-y-auto")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("checkout.grandTotal")}
          </div>
          <div className="text-xl font-semibold tracking-tight">
            {formatCurrency(checkoutFooterTotal)}
          </div>
        </div>
        <Button className="max-md:min-h-11" onClick={onPrimaryAction}>{primaryActionLabel}</Button>
      </div>

      {isCheckoutOpen && (
        <div className="mt-4 border-t pt-4">
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

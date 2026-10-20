import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
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
    <section className="sticky bottom-0 z-20 -mx-6 border-t bg-background/95 px-6 pb-4 pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("checkout.grandTotal")}
          </div>
          <div className="text-xl font-semibold tracking-tight">
            {formatCurrency(checkoutFooterTotal)}
          </div>
        </div>
        <Button onClick={onPrimaryAction}>{primaryActionLabel}</Button>
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
            <Button variant="outline" size="sm" onClick={onClose}>
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

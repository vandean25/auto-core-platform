import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ReceiptText } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { PurchaseBillFormModel } from '../form-model'

export function PurchaseBillReceiptPicker({ form }: { form: PurchaseBillFormModel }) {
  const { t } = useTranslation('finance')
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  if (!form.vendorId) return null

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-slate-50">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ReceiptText className="h-4 w-4" />
        {form.receiptSummaries.length > 0
          ? t('purchaseBills.form.receiptsFound', { count: form.receiptSummaries.length })
          : t('purchaseBills.form.receiptsNone')}
      </div>

      {form.isUnbilledLoading && (
        <p className="text-sm text-slate-500">{t('purchaseBills.form.checkingReceipts')}</p>
      )}

      {!form.isUnbilledLoading && form.receiptSummaries.length > 0 && (
        <div className="space-y-2">
          <Input
            value={form.receiptFilter}
            onChange={(event) => form.setReceiptFilter(event.target.value)}
            placeholder={t('purchaseBills.form.filterReceipts')}
          />

          {form.filteredReceiptSummaries.map((receipt) => {
            const isChecked = form.selectedReceiptIds.includes(receipt.id)
            return (
              <label
                key={receipt.id}
                className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(checked) =>
                      form.toggleReceiptSelection(receipt.id, Boolean(checked))
                    }
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{receipt.number}</span>
                    <span className="text-xs text-slate-500">
                      {t('shared.lineCountPending', {
                        lines: receipt.lineCount,
                        qty: receipt.pendingQuantity,
                      })}
                    </span>
                  </div>
                </div>
                <div className="text-sm font-medium">{formatCurrency(receipt.pendingAmount)}</div>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VendorCombobox } from '@/components/purchase-invoices/VendorCombobox'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { PurchaseBillFormModel } from '../form-model'

export function PurchaseBillHeaderFields({ form }: { form: PurchaseBillFormModel }) {
  const { t } = useTranslation('finance')
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  return (
    <>
      <div className="space-y-2 max-w-md">
        <Label htmlFor="vendor-combobox">{t('columns.vendor')}</Label>
        <div id="vendor-combobox">
          <VendorCombobox value={form.vendorId} onChange={form.handleVendorChange} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="vendorInvoiceNumber">{t('purchaseBills.form.vendorBillNumber')}</Label>
          <Input
            id="vendorInvoiceNumber"
            value={form.vendorInvoiceNumber}
            onChange={(event) => {
              form.setVendorInvoiceNumber(event.target.value)
              form.queueSave({ vendorInvoiceNumber: event.target.value })
            }}
            placeholder={t('purchaseBills.form.vendorBillPlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invoiceDate">{t('purchaseBills.form.invoiceDate')}</Label>
          <Input
            id="invoiceDate"
            type="date"
            value={form.invoiceDate}
            onChange={(event) => {
              form.setInvoiceDate(event.target.value)
              form.queueSave({ invoiceDate: event.target.value }, true)
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dueDate">{t('purchaseBills.form.dueDate')}</Label>
          <Input
            id="dueDate"
            type="date"
            value={form.dueDate}
            onChange={(event) => {
              form.setDueDate(event.target.value)
              form.queueSave({ dueDate: event.target.value }, true)
            }}
          />
        </div>
      </div>
    </>
  )
}

import { VendorCombobox } from '@/components/purchase-invoices/VendorCombobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PurchaseBillFormModel } from '../form-model'

export function PurchaseBillHeaderFields({ form }: { form: PurchaseBillFormModel }) {
  return (
    <>
      <div className="space-y-2 max-w-md">
        <Label htmlFor="vendor-combobox">Vendor</Label>
        <div id="vendor-combobox">
          <VendorCombobox value={form.vendorId} onChange={form.handleVendorChange} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="vendorInvoiceNumber">Vendor Bill #</Label>
          <Input
            id="vendorInvoiceNumber"
            value={form.vendorInvoiceNumber}
            onChange={(event) => {
              form.setVendorInvoiceNumber(event.target.value)
              form.queueSave({ vendorInvoiceNumber: event.target.value })
            }}
            placeholder="VND-2026-..."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invoiceDate">Invoice Date</Label>
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
          <Label htmlFor="dueDate">Due Date</Label>
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

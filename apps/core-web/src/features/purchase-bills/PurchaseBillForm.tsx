import { PurchaseBillHeaderFields } from './components/PurchaseBillHeaderFields'
import { PurchaseBillLineItemEditor } from './components/PurchaseBillLineItemEditor'
import { PurchaseBillPageHeader } from './components/PurchaseBillPageHeader'
import { PurchaseBillReceiptPicker } from './components/PurchaseBillReceiptPicker'
import { usePurchaseBillForm } from './hooks/usePurchaseBillForm'
import type { PurchaseBillFormProps } from './hooks/usePurchaseBillForm'

export type { PurchaseBillFormProps }

export function PurchaseBillForm(props: PurchaseBillFormProps) {
  const form = usePurchaseBillForm(props)

  return (
    <div className="space-y-6">
      <PurchaseBillPageHeader form={form} />
      <div className="bg-white rounded-lg border p-6 space-y-6">
        <PurchaseBillHeaderFields form={form} />
        <PurchaseBillReceiptPicker form={form} />
        <PurchaseBillLineItemEditor form={form} />
      </div>
    </div>
  )
}

import { format } from "date-fns"
import { useTranslation } from "react-i18next"

import { CustomerSearch } from "@/components/sales/CustomerSearch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { useInvoiceEditor } from "@/hooks/useInvoiceEditor"

type InvoiceEditor = ReturnType<typeof useInvoiceEditor>

/** The bill-to customer with its address, and the invoice and due dates. */
export function InvoiceDraftParties({ editor }: { editor: InvoiceEditor }) {
  const { t } = useTranslation("sales")

  return (
    <div className="grid grid-cols-2 gap-12 mb-12">
      <div className="space-y-4">
        <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
          {t("invoices.draft.billTo")}
        </Label>
        <CustomerSearch value={editor.customer} onChange={editor.setCustomer} />

        {editor.customer && (
          <div className="text-sm text-gray-600 mt-2 pl-1 border-l-2 border-gray-100">
            <p>{editor.customer.address_street || t("invoices.draft.noStreet")}</p>
            <p>{editor.customer.address_zip} {editor.customer.address_city}</p>
            <p>{editor.customer.address_country}</p>
            <p className="mt-1">{t("invoices.draft.emailLabel", { email: editor.customer.email })}</p>
          </div>
        )}
      </div>

      <div className="space-y-4 text-right">
        <div className="flex flex-col items-end gap-2">
          <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
            {t("invoices.draft.invoiceDate")}
          </Label>
          <Input
            type="date"
            className="w-40 text-right"
            value={format(editor.date, 'yyyy-MM-dd')}
            onChange={(e) => editor.setDate(new Date(e.target.value))}
          />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
            {t("invoices.draft.dueDate")}
          </Label>
          <Input
            type="date"
            className="w-40 text-right"
            value={format(editor.dueDate, 'yyyy-MM-dd')}
            onChange={(e) => editor.setDueDate(new Date(e.target.value))}
          />
        </div>
      </div>
    </div>
  )
}

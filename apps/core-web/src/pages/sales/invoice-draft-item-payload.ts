import type { CreateInvoicePayload } from '@/api/sales'
import type { InvoiceEditorItem } from '@/hooks/useInvoiceEditor'

export function invoiceEditorLineToPayloadItem(
  item: Pick<
    InvoiceEditorItem,
  | 'catalog_item_id'
    | 'workshop_task_line_item_id'
    | 'description'
    | 'quantity'
    | 'unit_price'
    | 'tax_rate'
  >,
): CreateInvoicePayload['items'][number] {
  return {
    catalogItemId: item.catalog_item_id,
    ...(item.workshop_task_line_item_id
      ? { workshopTaskLineItemId: item.workshop_task_line_item_id }
      : {}),
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    taxRate: item.tax_rate,
  }
}

export interface SalesOrderItemForm {
  catalog_item_id?: string
  description: string
  quantity: number
  unit_price: number
  tax_rate: number
}

export interface SalesOrderForm {
  customer_id: string
  notes: string
  items: SalesOrderItemForm[]
}

/** Request body of a sales order draft: the form with numeric fields normalized. */
export type SalesOrderPayload = {
  customer_id: string
  notes: string
  items: Array<{
    catalog_item_id?: string
    description: string
    quantity: number
    unit_price: number
    tax_rate: number
  }>
}

export function calculateOrderTotal(items: SalesOrderItemForm[]) {
  return items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0)
}

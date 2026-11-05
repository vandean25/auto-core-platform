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

export function toSalesOrderPayload(data: SalesOrderForm) {
  return {
    customer_id: data.customer_id,
    notes: data.notes,
    items: data.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      tax_rate: Number(item.tax_rate),
    })),
  }
}

export function calculateOrderTotal(items: SalesOrderItemForm[]) {
  return items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0)
}

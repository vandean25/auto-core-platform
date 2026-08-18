export interface BillLine {
  tempId: string
  source: 'receipt' | 'manual'
  receiptId?: string
  receiptNumber?: string
  catalogItemId?: string
  purchaseOrderItemId?: string
  description: string
  quantity: number
  unitCost: number
  taxRate: number
  maxQuantity?: number
}

export interface ReceiptSummary {
  id: string
  number: string
  lineCount: number
  pendingQuantity: number
  pendingAmount: number
}

export interface StagedBillItem {
  id: string
  sku: string
  name: string
  price: number
}

export type PurchaseBillSaveStatus = 'saved' | 'saving' | 'error'

export type PurchaseBillSnapshot = {
  vendorId: string
  vendorInvoiceNumber: string
  invoiceDate: string
  dueDate: string
  lines: BillLine[]
  immediate?: boolean
}

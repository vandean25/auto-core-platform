import salesDe from '../../../locales/de/sales.json' with { type: 'json' }
import financeDe from '../../../locales/de/finance.json' with { type: 'json' }
import customersDe from '../../../locales/de/customers.json' with { type: 'json' }
import vehicleStockDe from '../../../locales/de/vehicleStock.json' with { type: 'json' }
import workshopDe from '../../../locales/de/workshop.json' with { type: 'json' }
import deEnums from '../../../locales/de/enums.json' with { type: 'json' }

export const DE_FULLSTACK_SALES = {
  invoicesListTitle: salesDe.invoices.list.title,
  createInvoice: salesDe.orders.detail.createInvoice,
  finalize: salesDe.invoices.draft.finalize,
  finalizeDialogConfirm: salesDe.invoiceEditor.finalizeDialog.confirm,
  downloadPdf: salesDe.invoices.detail.downloadPdf,
  pdfSuccess: salesDe.invoices.detail.pdfSuccess,
  orderNotFound: salesDe.orders.detail.notFound,
  creditNote: salesDe.invoices.detail.creditNote,
} as const

export const DE_FULLSTACK_FINANCE = {
  creditReasonPlaceholder: financeDe.creditNotes.createDialog.reasonPlaceholder,
  createDraft: financeDe.actions.createDraft,
  finalizeAction: financeDe.actions.finalize,
  finalizeCredit: financeDe.creditNotes.detail.finalizeDialog.confirm,
  print: financeDe.actions.print,
  finalizedToast: financeDe.creditNotes.detail.toast.finalized,
} as const

export const DE_FULLSTACK_CUSTOMERS = {
  selectCustomer: customersDe.search.selectPlaceholder,
  searchPlaceholder: customersDe.search.searchPlaceholder,
} as const

export const DE_FULLSTACK_VEHICLE_STOCK = {
  purchase: vehicleStockDe.purchase,
  stockDetail: vehicleStockDe.stockDetail,
  sale: vehicleStockDe.sale,
  shared: vehicleStockDe.shared,
} as const

export const DE_FULLSTACK_WORKSHOP = {
  mechanicTask: workshopDe.mechanic.taskDetail.header,
  mechanicQueueTitle: workshopDe.mechanic.queue.title,
} as const

export const DE_FULLSTACK_STATUS = deEnums.status

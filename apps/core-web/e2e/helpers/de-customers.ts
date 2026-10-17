import customersDe from '../../../../locales/de/customers.json' with { type: 'json' }

/** German customers copy for Playwright locators (default UI locale). */
export const DE_CUSTOMERS = {
  list: {
    title: customersDe.list.title,
    addCustomer: customersDe.list.addCustomer,
  },
  detail: {
    contactInformation: customersDe.detail.contactInformation,
    newSalesOrder: customersDe.detail.newSalesOrder,
    invoiceHint: customersDe.detail.invoiceHint,
  },
  dialog: {
    addTitle: customersDe.dialog.addTitle,
  },
} as const

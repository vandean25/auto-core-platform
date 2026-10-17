import salesDe from '../../../../locales/de/sales.json' with { type: 'json' }

/** German sales copy for Playwright locators (default UI locale). */
export const DE_SALES = {
  orders: {
    list: {
      title: salesDe.orders.list.title,
      newOrder: salesDe.orders.list.newOrder,
    },
    detail: {
      backAria: salesDe.orders.detail.backAria,
      customerSection: salesDe.orders.detail.customer,
    },
  },
} as const

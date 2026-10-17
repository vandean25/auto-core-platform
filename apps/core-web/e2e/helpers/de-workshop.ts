import deWorkshop from '../../../../locales/de/workshop.json' with { type: 'json' }

/** German workshop UI strings for e2e (default locale). */
export const DE_WORKSHOP = {
  taskLineEditor: {
    searchPlaceholder: deWorkshop.taskLineEditor.searchPlaceholder,
    suggestionsAria: deWorkshop.taskLineEditor.suggestionsAria,
  },
  taskList: {
    fitmentSearch: deWorkshop.taskList.fitmentSearch,
  },
  orders: {
    list: {
      title: deWorkshop.orders.list.title,
    },
  },
} as const

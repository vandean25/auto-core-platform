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
      partsPickHint: deWorkshop.orders.list.partsPickHint,
      partsPickQueue: deWorkshop.orders.list.partsPickQueue,
    },
  },
  planner: {
    page: deWorkshop.planner.page,
    createSheet: deWorkshop.planner.createSheet,
    viewMode: deWorkshop.planner.viewMode,
    grid: deWorkshop.planner.grid,
  },
  capacity: {
    page: deWorkshop.capacity.page,
    cell: deWorkshop.capacity.cell,
  },
  pick: {
    queue: deWorkshop.pick.queue,
    drawer: deWorkshop.pick.drawer,
  },
  warranty: {
    editor: deWorkshop.warranty.editor,
    type: deWorkshop.warranty.type,
    list: deWorkshop.warranty.list,
    claimsPage: deWorkshop.warrantyClaimsPage,
  },
} as const

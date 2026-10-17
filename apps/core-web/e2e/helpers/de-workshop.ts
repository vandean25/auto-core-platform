import deWorkshop from '../../../../locales/de/workshop.json' with { type: 'json' }

/** German workshop UI strings for e2e (default locale). */
export const DE_WORKSHOP = {
  board: {
    title: deWorkshop.board.title,
    viewMode: deWorkshop.board.viewMode,
    unassigned: deWorkshop.board.unassigned,
    emptyResources: deWorkshop.board.emptyResources,
    assignError: deWorkshop.board.assignError,
    a11y: deWorkshop.board.a11y,
  },
  orderCard: deWorkshop.orderCard,
  mechanic: {
    queue: {
      title: deWorkshop.mechanic.queue.title,
    },
    taskDetail: {
      diagnostics: deWorkshop.mechanic.taskDetail.diagnostics,
      saveState: deWorkshop.mechanic.taskDetail.saveState,
      voiceNote: deWorkshop.mechanic.taskDetail.voiceNote,
    },
  },
  orderHeader: {
    orderInfo: deWorkshop.orderHeader.orderInfo,
  },
  orders: {
    list: {
      title: deWorkshop.orders.list.title,
      partsPickHint: deWorkshop.orders.list.partsPickHint,
      partsPickQueue: deWorkshop.orders.list.partsPickQueue,
      orderNo: deWorkshop.orders.list.columns.orderNo,
      rowAria: deWorkshop.orders.list.rowAria,
    },
  },
  taskLineEditor: {
    searchPlaceholder: deWorkshop.taskLineEditor.searchPlaceholder,
    suggestionsAria: deWorkshop.taskLineEditor.suggestionsAria,
  },
  taskList: {
    fitmentSearch: deWorkshop.taskList.fitmentSearch,
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
  orderIntake: {
    title: deWorkshop.orderIntake.title,
  },
  checkout: deWorkshop.checkout,
  checkoutSummary: {
    title: deWorkshop.checkoutSummary.title,
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

export function workshopEmptyMechanicsTitle(): string {
  return DE_WORKSHOP.board.emptyResources.title.replace(
    '{{resource}}',
    DE_WORKSHOP.board.emptyResources.mechanics,
  )
}

export function workshopOrderAssignAria(orderNumber: string): string {
  return DE_WORKSHOP.orderCard.assignAria.replace('{{orderNumber}}', orderNumber)
}

export function workshopOrderMoveAria(orderNumber: string): string {
  return DE_WORKSHOP.orderCard.move.replace('{{orderNumber}}', orderNumber)
}

function workshopMechanicColumnLabel(mechanicName: string): string {
  return DE_WORKSHOP.board.a11y.resourceColumn
    .replace('{{resource}}', DE_WORKSHOP.board.a11y.resourceNoun.mechanic)
    .replace('{{label}}', mechanicName)
}

export function workshopBoardA11yDroppedOn(orderNumber: string, mechanicName: string): string {
  return DE_WORKSHOP.board.a11y.droppedOn
    .replace('{{order}}', orderNumber)
    .replace('{{column}}', workshopMechanicColumnLabel(mechanicName))
}

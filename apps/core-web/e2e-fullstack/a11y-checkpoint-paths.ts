export const A11Y_FULLSTACK_CHECKPOINT_PATHS = {
  'auth-home': '/',
  'customers-list': '/customers',
  'login-screen': '/login',
  'sales-order-detail': '/sales-orders/so-1',
  'sales-invoice-draft-edit': '/sales/invoices/inv-1/edit',
  'sales-invoice-detail': '/sales/invoices/inv-1',
  'credit-note-detail': '/finance/credit-notes/cn-1',
  'vehicle-purchase-new': '/vehicle-stock/purchases/new',
  'vehicle-stock-detail': '/vehicle-stock/veh-1',
  'vehicle-sale-new': '/vehicle-stock/sales/new',
  'vehicle-sale-detail': '/vehicle-stock/sales/sale-1',
  'margin-scheme-invoice-detail': '/sales/invoices/inv-2',
  'workshop-checkout-panel': '/workshop/orders/wo-1',
  'workshop-command-preview': '/',
  'workshop-orders-list': '/workshop/orders',
  'workshop-board': '/workshop/board',
  'mechanic-queue': '/mechanic/queue',
  'mechanic-task-detail': '/mechanic/tasks/task-1',
} as const satisfies Record<string, string>

export const A11Y_FULLSTACK_ROUTE_PATHS: readonly string[] = Object.values(
  A11Y_FULLSTACK_CHECKPOINT_PATHS,
)

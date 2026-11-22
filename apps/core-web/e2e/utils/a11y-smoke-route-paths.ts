export const A11Y_SMOKE_IDS = {
  salesOrder: 'so-a11y-1',
  customer: 'cust-a11y-1',
  workshopOrder: 'ws-a11y-1',
  purchaseOrder: 'po-a11y-1',
  vendor: 'vendor-a11y-1',
} as const;

export const A11Y_SMOKE_PATHS_BY_NAME = {
  'sales order detail': `/sales-orders/${A11Y_SMOKE_IDS.salesOrder}`,
  'customer detail': `/customers/${A11Y_SMOKE_IDS.customer}`,
  'workshop order detail': `/workshop/orders/${A11Y_SMOKE_IDS.workshopOrder}`,
  'purchase order detail': `/purchase-orders/${A11Y_SMOKE_IDS.purchaseOrder}`,
  'workshop board': '/workshop/board',
  'settings: finance tab': '/settings',
  'settings: brands tab': '/settings?tab=brands',
  'settings: storage locations tab': '/settings?tab=locations',
  'settings: labor tab': '/settings?tab=labor',
  'customers list with add customer dialog open': '/customers',
  'sales orders list': '/sales-orders',
  'purchase orders list': '/purchase-orders',
  'inventory list': '/inventory',
  'vehicle stock list': '/vehicle-stock',
  'vendors list': '/vendors',
} as const;

export const A11Y_SMOKE_ROUTE_PATHS: readonly string[] = Object.values(A11Y_SMOKE_PATHS_BY_NAME);

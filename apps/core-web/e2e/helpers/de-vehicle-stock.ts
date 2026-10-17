import vehicleStockDe from '../../../../locales/de/vehicleStock.json' with { type: 'json' }

/** German vehicle-stock copy for Playwright locators (default UI locale). */
export const DE_VEHICLE_STOCK = {
  shared: {
    delete: vehicleStockDe.shared.delete,
  },
  stockList: {
    title: vehicleStockDe.stockList.title,
    addVehicle: vehicleStockDe.stockList.addVehicle,
  },
  sale: {
    gewaehrleistung: vehicleStockDe.sale.gewaehrleistung,
    saveStatus: {
      saving: vehicleStockDe.sale.saveStatus.saving,
      error: vehicleStockDe.sale.saveStatus.error,
    },
    warranty: {
      shorteningNegotiated: vehicleStockDe.sale.warranty.shorteningNegotiated,
    },
  },
} as const

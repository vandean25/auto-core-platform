import vehicleStockDe from '../../../../locales/de/vehicleStock.json' with { type: 'json' }

/** German vehicle-stock copy for Playwright locators (default UI locale). */
export const DE_VEHICLE_STOCK = {
  stockList: {
    title: vehicleStockDe.stockList.title,
    addVehicle: vehicleStockDe.stockList.addVehicle,
  },
} as const

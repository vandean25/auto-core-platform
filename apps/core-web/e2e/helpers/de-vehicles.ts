import vehiclesDe from '../../../../locales/de/vehicles.json' with { type: 'json' }

/** German vehicles copy for Playwright locators (default UI locale). */
export const DE_VEHICLES = {
  list: {
    title: vehiclesDe.list.title,
    addVehicle: vehiclesDe.list.addVehicle,
  },
} as const

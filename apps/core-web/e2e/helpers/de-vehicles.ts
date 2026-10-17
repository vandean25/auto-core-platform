import vehiclesDe from '../../../../locales/de/vehicles.json' with { type: 'json' }

/** German vehicles copy for Playwright locators (default UI locale). */
export const DE_VEHICLES = {
  list: {
    title: vehiclesDe.list.title,
    addVehicle: vehiclesDe.list.addVehicle,
    rowAria: vehiclesDe.list.rowAria,
  },
  detail: {
    vehicleInfo: vehiclesDe.detail.vehicleInfo,
    editVehicle: vehiclesDe.detail.editVehicle,
  },
  pickerlDue: {
    exportCsv: vehiclesDe.pickerlDue.exportCsv,
    createOrder: vehiclesDe.pickerlDue.createOrder,
  },
  gewaehrleistungDue: {
    title: vehiclesDe.gewaehrleistungDue.title,
  },
} as const

/** `list.rowAria` with `{{vehicle}}` filled in (e.g. "Fahrzeug Honda Civic"). */
export function deVehicleListRowAria(vehicleLabel: string): string {
  return vehiclesDe.list.rowAria.replace('{{vehicle}}', vehicleLabel)
}

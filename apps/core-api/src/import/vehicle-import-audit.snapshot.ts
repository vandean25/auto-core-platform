/** Vehicle import audit snapshots (includes Erstzulassung). */
export function pickVehicleImportAuditSnapshot(vehicle: {
  make: string;
  model: string;
  year: number;
  vin: string | null;
  plate: string | null;
  mileage: number | null;
  color: string | null;
  key_number: string | null;
  customer_id: string | null;
  first_registration_date?: Date | null;
}): Record<string, unknown> {
  return {
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    vin: vehicle.vin,
    plate: vehicle.plate,
    mileage: vehicle.mileage,
    color: vehicle.color,
    key_number: vehicle.key_number,
    customer_id: vehicle.customer_id,
    ...(vehicle.first_registration_date != null
      ? {
          first_registration_date: vehicle.first_registration_date
            .toISOString()
            .slice(0, 10),
        }
      : {}),
  };
}

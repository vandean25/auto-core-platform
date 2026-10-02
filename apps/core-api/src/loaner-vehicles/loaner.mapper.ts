import type {
  Customer,
  LoanerBooking,
  LoanerBookingStatus,
  LoanerVehicle,
  LoanerVehicleStatus,
  Vehicle,
} from '@prisma/client';

type LoanerVehicleWithVehicle = LoanerVehicle & {
  vehicle?: Pick<Vehicle, 'id' | 'make' | 'model' | 'year' | 'plate' | 'vin'>;
};

type LoanerBookingWithRelations = LoanerBooking & {
  customer?: Pick<Customer, 'id' | 'first_name' | 'last_name' | 'company_name'>;
  loaner_vehicle?: Pick<LoanerVehicle, 'id' | 'display_name' | 'site_id'>;
};

export type LoanerVehicleResponse = {
  id: string;
  siteId: string;
  vehicleId: string;
  displayName: string;
  status: LoanerVehicleStatus;
  dailyRateCents: number | null;
  insuranceNote: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  vehicle?: {
    id: string;
    make: string;
    model: string;
    year: number;
    plate: string | null;
    vin: string | null;
  };
};

export type LoanerBookingResponse = {
  id: string;
  loanerVehicleId: string;
  workshopOrderId: string | null;
  customerId: string;
  plannedFrom: Date;
  plannedTo: Date;
  status: LoanerBookingStatus;
  handedOverAt: Date | null;
  returnedAt: Date | null;
  odometerOut: number | null;
  odometerIn: number | null;
  fuelOut: number | null;
  fuelIn: number | null;
  damageNotesOut: string | null;
  damageNotesIn: string | null;
  driverLicenceChecked: boolean;
  licenceCheckedById: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    companyName: string | null;
  };
  loanerVehicle?: {
    id: string;
    displayName: string;
    siteId: string;
  };
};

export function mapLoanerVehicle(
  row: LoanerVehicleWithVehicle,
): LoanerVehicleResponse {
  return {
    id: row.id,
    siteId: row.site_id,
    vehicleId: row.vehicle_id,
    displayName: row.display_name,
    status: row.status,
    dailyRateCents: row.daily_rate_cents,
    insuranceNote: row.insurance_note,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.vehicle
      ? {
          vehicle: {
            id: row.vehicle.id,
            make: row.vehicle.make,
            model: row.vehicle.model,
            year: row.vehicle.year,
            plate: row.vehicle.plate,
            vin: row.vehicle.vin,
          },
        }
      : {}),
  };
}

export function mapLoanerBooking(
  row: LoanerBookingWithRelations,
): LoanerBookingResponse {
  return {
    id: row.id,
    loanerVehicleId: row.loaner_vehicle_id,
    workshopOrderId: row.workshop_order_id,
    customerId: row.customer_id,
    plannedFrom: row.planned_from,
    plannedTo: row.planned_to,
    status: row.status,
    handedOverAt: row.handed_over_at,
    returnedAt: row.returned_at,
    odometerOut: row.odometer_out,
    odometerIn: row.odometer_in,
    fuelOut: row.fuel_out,
    fuelIn: row.fuel_in,
    damageNotesOut: row.damage_notes_out,
    damageNotesIn: row.damage_notes_in,
    driverLicenceChecked: row.driver_licence_checked,
    licenceCheckedById: row.licence_checked_by_id,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.customer
      ? {
          customer: {
            id: row.customer.id,
            firstName: row.customer.first_name,
            lastName: row.customer.last_name,
            companyName: row.customer.company_name,
          },
        }
      : {}),
    ...(row.loaner_vehicle
      ? {
          loanerVehicle: {
            id: row.loaner_vehicle.id,
            displayName: row.loaner_vehicle.display_name,
            siteId: row.loaner_vehicle.site_id,
          },
        }
      : {}),
  };
}

export type WorkshopOrderLoanerBookingSummary = {
  id: string;
  status: LoanerBookingStatus;
  plannedFrom: Date;
  plannedTo: Date;
  loanerVehicleId: string;
  displayName: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehiclePlate: string | null;
};

export function mapWorkshopOrderLoanerBookingSummary(
  bookings: Array<
    LoanerBooking & {
      loaner_vehicle?: LoanerVehicle & {
        vehicle?: Pick<Vehicle, 'make' | 'model' | 'plate'>;
      };
    }
  >,
): WorkshopOrderLoanerBookingSummary | undefined {
  const booking = bookings[0];
  if (!booking?.loaner_vehicle) {
    return undefined;
  }

  return {
    id: booking.id,
    status: booking.status,
    plannedFrom: booking.planned_from,
    plannedTo: booking.planned_to,
    loanerVehicleId: booking.loaner_vehicle_id,
    displayName: booking.loaner_vehicle.display_name,
    vehicleMake: booking.loaner_vehicle.vehicle?.make ?? null,
    vehicleModel: booking.loaner_vehicle.vehicle?.model ?? null,
    vehiclePlate: booking.loaner_vehicle.vehicle?.plate ?? null,
  };
}

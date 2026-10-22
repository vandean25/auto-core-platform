import type {
  Customer,
  Vehicle,
  VehicleParty,
  VehiclePartyRole,
} from '@prisma/client';
import type {
  CustomerVehiclePartyDto,
  SuggestedBillToDto,
  VehiclePartiesResponseDto,
  VehiclePartyResponseDto,
} from './dto/vehicle-party.dto.js';
import { isActiveOn } from './vehicle-party.rules.js';
import { dateToDay } from './vehicle-party-date.util.js';
import { toPartyInterval } from './vehicle-party.writer.js';

export type PartyRowWithCustomer = VehicleParty & {
  customer: Pick<
    Customer,
    'id' | 'type' | 'company_name' | 'first_name' | 'last_name'
  >;
};

export function toPartyResponse(
  row: PartyRowWithCustomer,
  today: string,
): VehiclePartyResponseDto {
  return {
    id: row.id,
    vehicle_id: row.vehicle_id,
    customer_id: row.customer_id,
    role: row.role,
    valid_from: dateToDay(row.valid_from),
    valid_to: dateToDay(row.valid_to),
    source: row.source,
    notes: row.notes,
    is_active: isActiveOn(toPartyInterval(row), today),
    customer: row.customer,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPartiesResponse(
  rows: PartyRowWithCustomer[],
  suggestion: {
    customer_id: string;
    role: Extract<VehiclePartyRole, 'BILL_TO' | 'LEASING'>;
  } | null,
  today: string,
): VehiclePartiesResponseDto {
  const suggested: SuggestedBillToDto | null = suggestion
    ? {
        ...suggestion,
        customer: rows.find(
          (row) => row.customer_id === suggestion.customer_id,
        )!.customer,
      }
    : null;
  return {
    data: rows.map((row) => toPartyResponse(row, today)),
    suggested_bill_to: suggested,
  };
}

export type PartyRowWithVehicle = VehicleParty & {
  vehicle: Pick<Vehicle, 'id' | 'make' | 'model' | 'plate'>;
};

/** Customer detail view: one party row seen from the customer, with a vehicle summary. */
export function toCustomerVehiclePartyResponse(
  row: PartyRowWithVehicle,
  today: string,
): CustomerVehiclePartyDto {
  return {
    id: row.id,
    vehicle_id: row.vehicle_id,
    role: row.role,
    valid_from: dateToDay(row.valid_from),
    valid_to: dateToDay(row.valid_to),
    source: row.source,
    is_active: isActiveOn(toPartyInterval(row), today),
    vehicle: row.vehicle,
  };
}

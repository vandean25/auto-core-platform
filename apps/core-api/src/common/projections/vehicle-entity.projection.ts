import { stripVehicleIdentityResolutionState } from '../../vehicle/vehicle-identity.util.js';
import { VehicleInventoryRole } from '@prisma/client';

type VehicleLike = Parameters<typeof stripVehicleIdentityResolutionState>[0];

type WorkshopOrderWithVehicle = Record<string, unknown> & {
  vehicle?: VehicleLike | null;
};

export function stripVehicleListIdentity<T extends VehicleLike>(
  vehicles?: T[] | null,
) {
  return vehicles?.map(stripVehicleIdentityResolutionState);
}

export function projectVehicleOperationalFields<
  T extends Record<string, unknown>,
>(vehicle: T, authorizedSiteIds: readonly string[]): T {
  const role = vehicle.inventory_role;
  if (
    role !== VehicleInventoryRole.USED &&
    role !== VehicleInventoryRole.NEW &&
    role !== VehicleInventoryRole.DEMO
  ) {
    return vehicle;
  }

  const location = vehicle.location as
    { site_id?: string | null } | null | undefined;
  if (location?.site_id && authorizedSiteIds.includes(location.site_id)) {
    return vehicle;
  }

  return {
    ...vehicle,
    location_id: null,
    location: null,
    stock_status: null,
    inventory_role: null,
    reserved_for_customer_id: null,
    reserved_for_customer: null,
  };
}

export function projectVehicleListOperationalFields<
  T extends Record<string, unknown>,
>(vehicles: T[] | null | undefined, authorizedSiteIds: readonly string[]) {
  return vehicles?.map((vehicle) =>
    projectVehicleOperationalFields(vehicle, authorizedSiteIds),
  );
}

export function stripWorkshopOrderVehicleIdentity<
  T extends WorkshopOrderWithVehicle,
>(order: T, authorizedSiteIds: readonly string[] = []) {
  return {
    ...order,
    vehicle: order.vehicle
      ? projectVehicleOperationalFields(
          stripVehicleIdentityResolutionState(order.vehicle),
          authorizedSiteIds,
        )
      : order.vehicle,
  };
}

export function stripWorkshopOrdersVehicleIdentity<
  T extends WorkshopOrderWithVehicle,
>(orders?: T[] | null, authorizedSiteIds: readonly string[] = []) {
  return orders?.map((order) =>
    stripWorkshopOrderVehicleIdentity(order, authorizedSiteIds),
  );
}

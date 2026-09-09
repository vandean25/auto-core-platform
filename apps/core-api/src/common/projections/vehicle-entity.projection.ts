import { stripVehicleIdentityResolutionState } from '../../vehicle/vehicle-identity.util';

type VehicleLike = Parameters<typeof stripVehicleIdentityResolutionState>[0];

export function stripVehicleListIdentity<T extends VehicleLike>(
  vehicles?: T[] | null,
) {
  return vehicles?.map(stripVehicleIdentityResolutionState);
}

export function stripWorkshopOrderVehicleIdentity<
  T extends { vehicle?: VehicleLike | null },
>(order: T) {
  return {
    ...order,
    vehicle: order.vehicle
      ? stripVehicleIdentityResolutionState(order.vehicle)
      : order.vehicle,
  };
}

export function stripWorkshopOrdersVehicleIdentity<
  T extends { vehicle?: VehicleLike | null },
>(orders?: T[] | null) {
  return orders?.map(stripWorkshopOrderVehicleIdentity);
}

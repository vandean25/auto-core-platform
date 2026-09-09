import { stripVehicleIdentityResolutionState } from '../../vehicle/vehicle-identity.util';

type VehicleLike = Parameters<typeof stripVehicleIdentityResolutionState>[0];

type WorkshopOrderWithVehicle = Record<string, unknown> & {
  vehicle?: VehicleLike | null;
};

export function stripVehicleListIdentity<T extends VehicleLike>(
  vehicles?: T[] | null,
) {
  return vehicles?.map(stripVehicleIdentityResolutionState);
}

export function stripWorkshopOrderVehicleIdentity<
  T extends WorkshopOrderWithVehicle,
>(order: T) {
  return {
    ...order,
    vehicle: order.vehicle
      ? stripVehicleIdentityResolutionState(order.vehicle)
      : order.vehicle,
  };
}

export function stripWorkshopOrdersVehicleIdentity<
  T extends WorkshopOrderWithVehicle,
>(orders?: T[] | null) {
  return orders?.map(stripWorkshopOrderVehicleIdentity);
}

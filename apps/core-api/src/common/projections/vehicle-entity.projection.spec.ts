import {
  stripVehicleListIdentity,
  stripWorkshopOrdersVehicleIdentity,
} from './vehicle-entity.projection';

describe('vehicle-entity.projection', () => {
  const vehicleWithIdentityState = {
    id: 'vehicle-1',
    identity_resolution_generation: 'generation-1',
    identity_resolution_token: 'token-1',
  };

  it('strips identity resolution state from vehicle lists', () => {
    expect(stripVehicleListIdentity([vehicleWithIdentityState])).toEqual([
      { id: 'vehicle-1' },
    ]);
  });

  it('strips identity resolution state from workshop order vehicles', () => {
    expect(
      stripWorkshopOrdersVehicleIdentity([
        { id: 'order-1', vehicle: vehicleWithIdentityState },
      ]),
    ).toEqual([{ id: 'order-1', vehicle: { id: 'vehicle-1' } }]);
  });
});

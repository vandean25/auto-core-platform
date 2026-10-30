import 'reflect-metadata';
import { MECHANIC_ACCESSIBLE_KEY } from '../common/decorators/mechanic-accessible.decorator.js';
import { TyreStorageController } from './tyre-storage.controller.js';

describe('TyreStorageController mechanic access', () => {
  it.each(['findOne', 'inspect'] as const)('permits mechanics to %s', (method) => {
    expect(
      Reflect.getMetadata(MECHANIC_ACCESSIBLE_KEY, TyreStorageController.prototype[method]),
    ).toBe(true);
  });

  it.each(['create', 'update', 'remove', 'checkIn', 'checkOut', 'move', 'dispose', 'updateSettings'] as const)(
    'keeps %s restricted to office sessions',
    (method) => {
      expect(
        Reflect.getMetadata(MECHANIC_ACCESSIBLE_KEY, TyreStorageController.prototype[method]),
      ).toBeUndefined();
      expect(Reflect.getMetadata(MECHANIC_ACCESSIBLE_KEY, TyreStorageController)).toBeUndefined();
    },
  );
});

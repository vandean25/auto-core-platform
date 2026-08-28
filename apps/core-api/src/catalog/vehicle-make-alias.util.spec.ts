import { normalizeVehicleMakeAlias } from './vehicle-make-alias.util';

describe('normalizeVehicleMakeAlias', () => {
  it('uppercases and strips non-alphanumeric characters', () => {
    expect(normalizeVehicleMakeAlias('Peugeot SA')).toBe('PEUGEOTSA');
    expect(normalizeVehicleMakeAlias('PEUGEOT')).toBe('PEUGEOT');
  });

  it('removes diacritics', () => {
    expect(normalizeVehicleMakeAlias('Citroën')).toBe('CITROEN');
    expect(normalizeVehicleMakeAlias('ŠKODA')).toBe('SKODA');
  });
});

import { normalizeVehicleMakeAlias } from './vehicle-make-alias.util';

describe('normalizeVehicleMakeAlias', () => {
  it('uppercases and strips non-alphanumeric characters', () => {
    expect(normalizeVehicleMakeAlias('Peugeot SA')).toBe('PEUGEOTSA');
    expect(normalizeVehicleMakeAlias('PEUGEOT')).toBe('PEUGEOT');
  });

  it('removes diacritics', () => {
    expect(normalizeVehicleMakeAlias('Citroën')).toBe('CITROEN');
    expect(normalizeVehicleMakeAlias('Citroën SA')).toBe('CITROENSA');
    expect(normalizeVehicleMakeAlias('ŠKODA')).toBe('SKODA');
  });

  it('matches PostgreSQL unaccent for Latin letters outside NFD decomposition', () => {
    expect(normalizeVehicleMakeAlias('Øresund')).toBe('ORESUND');
    expect(normalizeVehicleMakeAlias('Æther')).toBe('AETHER');
    expect(normalizeVehicleMakeAlias('Łada')).toBe('LADA');
    expect(normalizeVehicleMakeAlias('Œuvre')).toBe('OEUVRE');
    expect(normalizeVehicleMakeAlias('Đakovo')).toBe('DAKOVO');
    expect(normalizeVehicleMakeAlias('Þingvellir')).toBe('THINGVELLIR');
    expect(normalizeVehicleMakeAlias('Ðresund')).toBe('DRESUND');
    expect(normalizeVehicleMakeAlias('ßeta')).toBe('ETA');
    expect(normalizeVehicleMakeAlias('ĸel')).toBe('EL');
  });
});

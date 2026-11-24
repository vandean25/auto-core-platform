import { checkArt9FieldSafety } from './art9-guard.js';

describe('art9-guard', () => {
  it('blocks strongly matching Art 9 health field name "Gesundheitszustand"', () => {
    const result = checkArt9FieldSafety('Gesundheitszustand', 'gesundheitszustand');
    expect(result.status).toBe('BLOCKED');
    expect(result.matchedKeywords).toContain('gesundheitszustand');
  });

  it.each([
    ['Religion', 'religion'],
    ['Gewerkschaft', 'gewerkschaft'],
    ['Biometrische Daten', 'biometrie'],
    ['Sexuelle Orientierung', 'sexuelle_orientierung'],
    ['Ethnische Herkunft', 'ethnische_herkunft'],
    ['Genetische Merkmale', 'genetik'],
  ])('blocks strongly matching Art 9 field %s', (label, key) => {
    const result = checkArt9FieldSafety(label, key);
    expect(result.status).toBe('BLOCKED');
  });

  it.each([
    ['Gesundheitshinweis', 'gesundheitshinweis'],
    ['Allergie-Hinweis', 'allergie_hinweis'],
    ['Kirchensteuer-Status', 'kirche'],
    ['Medizinischer Transport', 'medizinischer_transport'],
  ])('triggers WARNING requiring confirmation for moderate Art 9 keyword in %s', (label, key) => {
    const result = checkArt9FieldSafety(label, key);
    expect(result.status).toBe('WARNING');
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });

  it.each([
    ['Flottennummer', 'flottennummer'],
    ['Bevorzugter Ansprechpartner', 'bevorzugter_ansprechpartner'],
    ['Winterreifen-Größe', 'winterreifen_groesse'],
    ['Leasinggeber', 'leasinggeber'],
  ])('allows normal workshop field %s', (label, key) => {
    const result = checkArt9FieldSafety(label, key);
    expect(result.status).toBe('OK');
    expect(result.matchedKeywords).toEqual([]);
  });
});

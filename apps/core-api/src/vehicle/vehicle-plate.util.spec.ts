import { normalizePlate, withPlateNormalized } from './vehicle-plate.util.js';

describe('normalizePlate', () => {
  it.each([
    ['w 12345 a', 'W12345A'],
    ['W-12345-A', 'W12345A'],
    ['W.12345.A', 'W12345A'],
    ['  g 123\tab ', 'G123AB'],
    ['M-AB 1234', 'MAB1234'],
  ])(
    'strips spaces, hyphens and dots and upper-cases %p',
    (input, expected) => {
      expect(normalizePlate(input)).toBe(expected);
    },
  );

  it.each([[null], [undefined], [''], ['   '], ['- . -']])(
    'returns null for empty input %p',
    (input) => {
      expect(normalizePlate(input)).toBeNull();
    },
  );
});

describe('withPlateNormalized', () => {
  it('derives plate_normalized when the plate is written', () => {
    expect(withPlateNormalized({ plate: 'w 12345-a', make: 'x' })).toEqual({
      plate: 'w 12345-a',
      make: 'x',
      plate_normalized: 'W12345A',
    });
  });

  it('clears plate_normalized when the plate is cleared', () => {
    expect(withPlateNormalized({ plate: null })).toEqual({
      plate: null,
      plate_normalized: null,
    });
    expect(withPlateNormalized({ plate: '  ' }).plate_normalized).toBeNull();
  });

  it('understands the Prisma set form of an update', () => {
    expect(
      withPlateNormalized({ plate: { set: 'g-1.2' } }).plate_normalized,
    ).toBe('G12');
  });

  it('leaves data untouched when the plate is not written', () => {
    const data = { make: 'x' };
    expect(withPlateNormalized(data)).toBe(data);
    expect(withPlateNormalized({ plate: undefined })).not.toHaveProperty(
      'plate_normalized',
    );
  });
});

import { normalizePlate } from './vehicle-plate.util.js';

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

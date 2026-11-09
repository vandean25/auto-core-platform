import { catalogItemRevisionToJsonInteger } from './catalog-item-revision-json.util.js';

describe('catalogItemRevisionToJsonInteger', () => {
  it('returns a JSON-safe integer within MAX_SAFE_INTEGER', () => {
    expect(catalogItemRevisionToJsonInteger(BigInt(42))).toBe(42);
  });

  it('throws when revision exceeds MAX_SAFE_INTEGER', () => {
    expect(() =>
      catalogItemRevisionToJsonInteger(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    ).toThrow(/safe integer/);
  });
});

import {
  PERMISSION_CATALOGUE,
  PERMISSION_CATALOGUE_VERSION,
} from './permission-catalogue.js';
import { findUnknownPermissions } from './permission-coverage.js';

describe('permission catalogue validation', () => {
  it('rejects a mapping that references an identifier outside the catalogue', () => {
    const problems = findUnknownPermissions({
      'FixtureController.known': { permissions: ['stock.read'] },
      'FixtureController.typo': { permissions: ['stock.recieve'] },
    });

    expect(problems).toEqual([
      'unknown permission "stock.recieve" in FixtureController.typo',
    ]);
  });

  it('keeps identifiers unique and dotted, and the version a positive integer', () => {
    const ids = PERMISSION_CATALOGUE.map((permission) => permission.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      ids.filter((id) => !/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/.test(id)),
    ).toEqual([]);
    expect(Number.isInteger(PERMISSION_CATALOGUE_VERSION)).toBe(true);
    expect(PERMISSION_CATALOGUE_VERSION).toBeGreaterThan(0);
  });
});

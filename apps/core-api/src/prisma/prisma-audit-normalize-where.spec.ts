import { Prisma } from '@prisma/client';
import { normalizeWhereForFindFirst } from './prisma-audit.extension.js';

describe('normalizeWhereForFindFirst', () => {
  it('flattens compound unique filters for findFirst compatibility', () => {
    expect(
      normalizeWhereForFindFirst({
        tenant_id_code: { tenant_id: 'tenant-1', code: 'SKU-1' },
      }),
    ).toEqual({
      tenant_id: 'tenant-1',
      code: 'SKU-1',
    });
  });

  it('preserves simple scalar filters', () => {
    expect(normalizeWhereForFindFirst({ id: 'cust-1' })).toEqual({
      id: 'cust-1',
    });
  });

  it('preserves field filter objects with Prisma operators', () => {
    expect(
      normalizeWhereForFindFirst({
        balance: { gte: new Prisma.Decimal('10.00') },
      }),
    ).toEqual({
      balance: { gte: expect.any(Prisma.Decimal) },
    });
  });

  it('does not flatten Prisma.Decimal field values', () => {
    const decimal = new Prisma.Decimal('42.50');
    expect(
      normalizeWhereForFindFirst({
        amount: decimal,
      }),
    ).toEqual({
      amount: decimal,
    });
  });

  it('preserves NOT filters', () => {
    expect(
      normalizeWhereForFindFirst({
        NOT: { id: 'deleted-row' },
      }),
    ).toEqual({
      NOT: { id: 'deleted-row' },
    });
  });

  it('preserves relation filters', () => {
    expect(
      normalizeWhereForFindFirst({
        lines: { some: { status: 'OPEN' } },
      }),
    ).toEqual({
      lines: { some: { status: 'OPEN' } },
    });
  });

  it('keeps empty compound-unique objects instead of flattening to an empty where', () => {
    expect(
      normalizeWhereForFindFirst({
        tenant_id_code: {},
      }),
    ).toEqual({
      tenant_id_code: {},
    });
  });

  it('returns null when normalization would yield no filters', () => {
    expect(normalizeWhereForFindFirst({})).toBeNull();
  });
});

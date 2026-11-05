import { andCombineListWhere, buildKeysetAfterClause } from './list-keyset.js';

describe('list-keyset', () => {
  it('ASC with equal sort values pages by id without gaps', () => {
    const clause = buildKeysetAfterClause('make', 'asc', 'Audi', 'id-b', {
      sortIsNullable: false,
    });
    expect(clause).toEqual({
      OR: [
        { make: { gt: 'Audi' } },
        { AND: [{ make: 'Audi' }, { id: { gt: 'id-b' } }] },
      ],
    });
  });

  it('ASC cursor on NULL sort values keeps NULLS LAST', () => {
    const clause = buildKeysetAfterClause('plate', 'asc', null, 'id-z', {
      sortIsNullable: true,
    });
    expect(clause).toEqual({
      AND: [{ plate: null }, { id: { gt: 'id-z' } }],
    });
  });

  it('DESC cursor on NULL sort values keeps NULLS LAST', () => {
    const clause = buildKeysetAfterClause('plate', 'desc', null, 'id-z', {
      sortIsNullable: true,
    });
    expect(clause).toEqual({
      AND: [{ plate: null }, { id: { lt: 'id-z' } }],
    });
  });

  it.each([
    [
      'DESC on a non-nullable field',
      'make',
      'desc',
      'Audi',
      'id-b',
      false,
      {
        OR: [
          { make: { lt: 'Audi' } },
          { AND: [{ make: 'Audi' }, { id: { lt: 'id-b' } }] },
        ],
      },
    ],
    [
      'DESC on a nullable field keeps NULLS LAST branch',
      'plate',
      'desc',
      'W-1',
      'id-z',
      true,
      {
        OR: [
          { plate: { lt: 'W-1' } },
          { AND: [{ plate: 'W-1' }, { id: { lt: 'id-z' } }] },
          { plate: null },
        ],
      },
    ],
  ])(
    'buildKeysetAfterClause %s',
    (_label, field, direction, sortValue, id, nullable, expected) => {
      expect(
        buildKeysetAfterClause(field, direction, sortValue, id, {
          sortIsNullable: nullable,
        }),
      ).toEqual(expected);
    },
  );

  it('AND-combines keyset clauses with search OR filters intact', () => {
    const base = {
      tenant_id: 't1',
      OR: [{ name: { contains: 'filter', mode: 'insensitive' } }],
    };
    const combined = andCombineListWhere(base, {
      OR: [{ sku: { gt: 'A' } }],
    });
    expect(combined).toEqual({
      AND: [base, { OR: [{ sku: { gt: 'A' } }] }],
    });
  });
});

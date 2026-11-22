import {
  andCombineListWhere,
  buildKeysetAfterClause,
  buildPrismaNullsLastOrderBy,
} from './list-keyset.js';
import type { KeysetSortDirection } from './list-keyset.types.js';

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
        buildKeysetAfterClause(
          field,
          direction as KeysetSortDirection,
          sortValue,
          id,
          {
            sortIsNullable: nullable,
          },
        ),
      ).toEqual(expected);
    },
  );

  it('DESC with a nullable secondary sort breaks same-date ties by secondary field NULLS LAST then id', () => {
    const date = new Date('2026-03-01T10:00:00.000Z');
    const clause = buildKeysetAfterClause('date', 'desc', date, 'id-b', {
      sortIsNullable: false,
      secondary: {
        field: 'invoice_number',
        value: 'RE-2026-0011',
        nullable: true,
      },
    });
    expect(clause).toEqual({
      OR: [
        { date: { lt: date } },
        {
          AND: [
            { date },
            {
              OR: [
                { invoice_number: { lt: 'RE-2026-0011' } },
                {
                  AND: [
                    { invoice_number: 'RE-2026-0011' },
                    { id: { lt: 'id-b' } },
                  ],
                },
                { invoice_number: null },
              ],
            },
          ],
        },
      ],
    });
  });

  it('ASC with a null secondary cursor value stays in the same-date NULLS LAST tail', () => {
    const date = new Date('2026-03-01T10:00:00.000Z');
    const clause = buildKeysetAfterClause('date', 'asc', date, 'id-b', {
      sortIsNullable: false,
      secondary: {
        field: 'invoice_number',
        value: null,
        nullable: true,
      },
    });
    expect(clause).toEqual({
      OR: [
        { date: { gt: date } },
        {
          AND: [
            { date },
            {
              AND: [{ invoice_number: null }, { id: { gt: 'id-b' } }],
            },
          ],
        },
      ],
    });
  });

  it('buildPrismaNullsLastOrderBy places nullable secondary sort between primary and id', () => {
    expect(
      buildPrismaNullsLastOrderBy('date', 'desc', {
        sortIsNullable: false,
        secondary: { field: 'invoice_number', nullable: true },
      }),
    ).toEqual([
      { date: 'desc' },
      { invoice_number: { sort: 'desc', nulls: 'last' } },
      { id: 'desc' },
    ]);
  });

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

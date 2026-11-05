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

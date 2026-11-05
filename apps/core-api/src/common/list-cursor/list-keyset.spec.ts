import {
  decodeListCursor,
  encodeListCursor,
} from './list-cursor.codec.js';
import { LIST_CURSOR_ENDPOINT } from './list-cursor.constants.js';
import { hashListFilterContext } from './list-cursor.filter-hash.js';
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

describe('list-cursor codec', () => {
  it('round-trips a versioned cursor and rejects malformed tokens', () => {
    const fh = hashListFilterContext({ search: 'x' });
    const encoded = encodeListCursor({
      v: 1,
      ep: LIST_CURSOR_ENDPOINT.inventory,
      sort: 'sku',
      dir: 'asc',
      fh,
      tid: '11111111-1111-4111-8111-111111111111',
      sid: '22222222-2222-4222-8222-222222222222',
      sv: 'SKU-1',
      id: '33333333-3333-4333-8333-333333333333',
    });
    expect(decodeListCursor(encoded)?.id).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(decodeListCursor('not-valid')).toBeNull();
  });
});

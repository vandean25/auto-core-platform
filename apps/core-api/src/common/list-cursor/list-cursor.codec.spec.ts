import { LIST_CURSOR_ENDPOINT, LIST_CURSOR_VERSION } from './list-cursor.constants.js';
import {
  decodeListCursor,
  deserializeSortValueFromCursor,
  encodeListCursor,
  parseListCursorParam,
  serializeSortValueForCursor,
  type ListCursorPayload,
} from './list-cursor.codec.js';
import { Prisma } from '@prisma/client';

const tenantId = '11111111-1111-4111-8111-111111111111';
const siteId = '22222222-2222-4222-8222-222222222222';
const rowId = '33333333-3333-4333-8333-333333333333';

function samplePayload(overrides: Partial<ListCursorPayload> = {}): ListCursorPayload {
  return {
    v: LIST_CURSOR_VERSION,
    ep: LIST_CURSOR_ENDPOINT.vehicleStock,
    sort: 'make',
    dir: 'asc',
    fh: 'filter-hash',
    tid: tenantId,
    sid: siteId,
    sv: 'Audi',
    id: rowId,
    ...overrides,
  };
}

describe('list-cursor.codec', () => {
  it('round-trips a valid payload', () => {
    const encoded = encodeListCursor(samplePayload());
    expect(decodeListCursor(encoded)).toEqual(samplePayload());
  });

  it.each([
    ['not-base64url', '!!!'],
    ['wrong version', encodeListCursor({ ...samplePayload(), v: 0 as typeof LIST_CURSOR_VERSION })],
    ['empty sort', encodeListCursor({ ...samplePayload(), sort: '' })],
    ['bad direction', encodeListCursor({ ...samplePayload(), dir: 'up' as 'asc' })],
    ['empty filter hash', encodeListCursor({ ...samplePayload(), fh: '' })],
    ['bad tenant uuid', encodeListCursor({ ...samplePayload(), tid: 'not-a-uuid' })],
    ['bad row uuid', encodeListCursor({ ...samplePayload(), id: 'bad' })],
    ['invalid sort value', encodeListCursor({ ...samplePayload(), sv: { x: 1 } as unknown as null })],
  ])('rejects %s cursors', (_label, encoded) => {
    expect(decodeListCursor(encoded)).toBeNull();
  });

  it('accepts null and boolean sort values', () => {
    expect(decodeListCursor(encodeListCursor({ ...samplePayload(), sv: null }))?.sv).toBeNull();
    expect(decodeListCursor(encodeListCursor({ ...samplePayload(), sv: true }))?.sv).toBe(true);
  });

  it('serializes Prisma Decimal sort values as strings', () => {
    expect(serializeSortValueForCursor(new Prisma.Decimal('12.50'))).toBe('12.5');
    const encoded = encodeListCursor({
      ...samplePayload(),
      sv: serializeSortValueForCursor(new Prisma.Decimal('99.99')),
    });
    expect(decodeListCursor(encoded)?.sv).toBe('99.99');
  });

  it('parseListCursorParam throws when bindings mismatch', () => {
    const encoded = encodeListCursor(samplePayload({ fh: 'other-hash' }));
    expect(() =>
      parseListCursorParam(encoded, {
        endpoint: LIST_CURSOR_ENDPOINT.vehicleStock,
        tenantId,
        siteId,
        filterHash: 'filter-hash',
        sortField: 'make',
        sortDirection: 'asc',
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'LIST_CURSOR_INVALID' }),
      }),
    );
  });

  // Regression: a tampered date sort value reached Prisma as an Invalid Date and failed with a 500.
  it.each([
    ['no milliseconds', '2026-11-13T08:00:00Z'],
    ['microseconds', '2026-11-13T08:00:00.123456Z'],
    ['offset instead of UTC', '2026-11-13T09:00:00.000+01:00'],
    ['impossible date', '2026-02-30T08:00:00.000Z'],
    ['not a date', 'yesterday'],
  ])('rejects a date sort value with %s as LIST_CURSOR_INVALID', (_label, value) => {
    expect(() => deserializeSortValueFromCursor(value, 'date')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'LIST_CURSOR_INVALID' }),
      }),
    );
  });

  it('round-trips a millisecond UTC date sort value exactly', () => {
    const date = new Date('2026-11-13T08:00:00.120Z');
    const serialized = serializeSortValueForCursor(date);
    expect(serialized).toBe('2026-11-13T08:00:00.120Z');
    expect(deserializeSortValueFromCursor(serialized, 'date')).toEqual(date);
  });
});

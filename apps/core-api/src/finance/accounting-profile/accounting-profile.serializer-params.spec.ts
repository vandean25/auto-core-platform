import { BadRequestException } from '@nestjs/common';
import {
  parseAccountingProfileSerializerParams,
  serializeAccountingProfileSerializerParams,
} from './accounting-profile.serializer-params.js';

describe('accounting-profile serializer params (RZL)', () => {
  it('returns empty params for missing or non-RZL input', () => {
    expect(parseAccountingProfileSerializerParams(null)).toEqual({});
    expect(parseAccountingProfileSerializerParams({})).toEqual({});
  });

  it('keeps legacy RZL params without Steuercodes as explicit nulls', () => {
    expect(
      parseAccountingProfileSerializerParams({
        rzl: { firmNumber: 'FN-1', costCenterLength: 4 },
      }),
    ).toEqual({
      rzl: {
        firmNumber: 'FN-1',
        costCenterLength: 4,
        steuercodes: { vat20: null, vat13: null, vat10: null },
      },
    });
  });

  it('trims Steuercodes and round-trips them through storage', () => {
    const parsed = parseAccountingProfileSerializerParams({
      rzl: {
        firmNumber: ' FN-9 ',
        steuercodes: { vat20: ' 20 ', vat13: '13', vat10: '' },
      },
    });

    expect(parsed.rzl?.steuercodes).toEqual({
      vat20: '20',
      vat13: '13',
      vat10: null,
    });
    expect(
      serializeAccountingProfileSerializerParams(parsed),
    ).toEqual({
      rzl: {
        firmNumber: 'FN-9',
        costCenterLength: null,
        steuercodes: { vat20: '20', vat13: '13', vat10: null },
      },
    });
  });

  it.each([
    { vat20: 'ABC' },
    { vat13: '12345' },
    { vat10: 10 },
    { vat20: '2 0' },
  ])('rejects invalid Steuercode %o', (steuercodes) => {
    expect(() =>
      parseAccountingProfileSerializerParams({ rzl: { steuercodes } }),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-object steuercodes value', () => {
    expect(() =>
      parseAccountingProfileSerializerParams({
        rzl: { steuercodes: ['20'] },
      }),
    ).toThrow('serializerParams.rzl.steuercodes must be an object');
  });
});

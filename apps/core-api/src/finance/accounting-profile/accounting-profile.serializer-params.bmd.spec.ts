import { BadRequestException } from '@nestjs/common';
import {
  parseAccountingProfileSerializerParams,
  serializeAccountingProfileSerializerParams,
} from './accounting-profile.serializer-params.js';

describe('accounting profile serializer params (BMD block)', () => {
  it('parses BMD Steuercodes with trimming and blanks as null', () => {
    expect(
      parseAccountingProfileSerializerParams({
        bmd: { steuercodes: { vat20: ' 5020 ', vat13: '5013', vat10: null } },
      }),
    ).toEqual({
      bmd: { steuercodes: { vat20: '5020', vat13: '5013', vat10: null } },
    });
  });

  it('parses RZL params exactly as before and adds no bmd key', () => {
    const parsed = parseAccountingProfileSerializerParams({
      rzl: { firmNumber: 'FN-1', steuercodes: { vat20: '20' } },
    });

    expect(parsed).toEqual({
      rzl: {
        firmNumber: 'FN-1',
        costCenterLength: null,
        steuercodes: { vat20: '20', vat13: null, vat10: null },
      },
    });
    expect(parsed).not.toHaveProperty('bmd');
  });

  it('parses RZL and BMD blocks side by side', () => {
    const parsed = parseAccountingProfileSerializerParams({
      rzl: { firmNumber: 'FN-1' },
      bmd: { steuercodes: { vat20: '5020' } },
    });

    expect(parsed.rzl?.firmNumber).toBe('FN-1');
    expect(parsed.bmd).toEqual({
      steuercodes: { vat20: '5020', vat13: null, vat10: null },
    });
  });

  it('rejects non-digit BMD Steuercodes and names the BMD path', () => {
    expect(() =>
      parseAccountingProfileSerializerParams({
        bmd: { steuercodes: { vat20: 'ab' } },
      }),
    ).toThrow(
      new BadRequestException(
        'serializerParams.bmd.steuercodes.vat20 must be 1 to 4 digits',
      ),
    );
  });

  it('rejects a bmd block that is not an object', () => {
    expect(() =>
      parseAccountingProfileSerializerParams({ bmd: 'x' }),
    ).toThrow(
      new BadRequestException('serializerParams.bmd must be an object'),
    );
  });

  it('serializes only the BMD block when only BMD is set', () => {
    expect(
      serializeAccountingProfileSerializerParams({
        bmd: { steuercodes: { vat20: '5020', vat13: null, vat10: null } },
      }),
    ).toEqual({
      bmd: { steuercodes: { vat20: '5020', vat13: null, vat10: null } },
    });
  });

  it('serializes RZL exactly as before', () => {
    expect(
      serializeAccountingProfileSerializerParams({
        rzl: {
          firmNumber: 'FN-1',
          costCenterLength: null,
          steuercodes: { vat20: '20' },
        },
      }),
    ).toEqual({
      rzl: {
        firmNumber: 'FN-1',
        costCenterLength: null,
        steuercodes: { vat20: '20', vat13: null, vat10: null },
      },
    });
  });
});

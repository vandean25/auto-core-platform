import { BadRequestException } from '@nestjs/common';
import {
  mergeAccountingProfileSerializerParams,
  parseAccountingProfileSerializerParams,
  parseMarginSchemeSerializerParams,
  serializeAccountingProfileSerializerParams,
} from './accounting-profile.serializer-params.js';

describe('accounting-profile serializer params (margin scheme)', () => {
  it('stores nothing for profiles without a margin setting, so default profiles keep their stored JSON', () => {
    expect(parseAccountingProfileSerializerParams({})).toEqual({});
    expect(
      serializeAccountingProfileSerializerParams({
        marginScheme: { enabled: false, vatAccount: null },
      }),
    ).toEqual({});
  });

  it('round-trips an enabled margin scheme with its margin VAT account', () => {
    const parsed = parseAccountingProfileSerializerParams({
      marginScheme: { enabled: true, vatAccount: ' 1776 ' },
    });

    expect(parsed).toEqual({
      marginScheme: { enabled: true, vatAccount: '1776' },
    });
    expect(
      parseAccountingProfileSerializerParams(
        serializeAccountingProfileSerializerParams(parsed),
      ),
    ).toEqual(parsed);
  });

  it('accepts a disabled margin scheme without a VAT account', () => {
    expect(
      parseAccountingProfileSerializerParams({
        marginScheme: { enabled: false },
      }),
    ).toEqual({ marginScheme: { enabled: false, vatAccount: null } });
  });

  it('rejects enabling the margin scheme without a margin VAT account', () => {
    expect(() =>
      parseAccountingProfileSerializerParams({
        marginScheme: { enabled: true, vatAccount: null },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseAccountingProfileSerializerParams({
        marginScheme: { enabled: true, vatAccount: '  ' },
      }),
    ).toThrow(
      'serializerParams.marginScheme.vatAccount is required when margin export is enabled',
    );
  });

  it('rejects a margin VAT account that is not 1 to 9 digits', () => {
    for (const vatAccount of ['17 76', 'AB12', '1234567890']) {
      expect(() =>
        parseAccountingProfileSerializerParams({
          marginScheme: { enabled: true, vatAccount },
        }),
      ).toThrow(
        'serializerParams.marginScheme.vatAccount must be 1 to 9 digits',
      );
    }
  });

  it('rejects a non-boolean enabled flag', () => {
    expect(() =>
      parseAccountingProfileSerializerParams({
        marginScheme: { enabled: 'yes', vatAccount: '1776' },
      }),
    ).toThrow('serializerParams.marginScheme.enabled must be a boolean');
  });

  it('keeps the stored margin setting when a patch only changes RZL params', () => {
    const existing = {
      marginScheme: { enabled: true, vatAccount: '1776' },
    };
    const patch = parseAccountingProfileSerializerParams({
      rzl: { firmNumber: 'FN-1', costCenterLength: null },
    });

    expect(mergeAccountingProfileSerializerParams(existing, patch)).toEqual({
      rzl: patch.rzl,
      marginScheme: { enabled: true, vatAccount: '1776' },
    });
  });

  it('keeps the stored BMD params when a patch only changes RZL or margin params', () => {
    const existing = {
      bmd: { steuercodes: { vat20: '9', vat13: null, vat10: null } },
    };

    expect(
      mergeAccountingProfileSerializerParams(existing, {
        rzl: { firmNumber: 'FN-1' },
      }),
    ).toEqual({
      bmd: { steuercodes: { vat20: '9', vat13: null, vat10: null } },
      rzl: expect.objectContaining({ firmNumber: 'FN-1' }),
    });
  });

  it('clears the stored BMD params only when the patch sends bmd as null', () => {
    const existing = { bmd: { steuercodes: { vat20: '9' } } };

    expect(
      mergeAccountingProfileSerializerParams(existing, { bmd: null }),
    ).toEqual({});
  });

  it('clears the stored RZL params only when the patch sends rzl as null', () => {
    const stored = {
      rzl: {
        firmNumber: 'FN-1',
        costCenterLength: null,
        steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
      },
      marginScheme: { enabled: true, vatAccount: '1776' },
    };

    expect(
      mergeAccountingProfileSerializerParams(stored, { rzl: null }),
    ).toEqual({ marginScheme: { enabled: true, vatAccount: '1776' } });
  });

  it('keeps the stored RZL params when a patch only changes the margin scheme', () => {
    const stored = {
      rzl: {
        firmNumber: 'FN-1',
        costCenterLength: null,
        steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
      },
    };

    expect(
      mergeAccountingProfileSerializerParams(stored, {
        marginScheme: { enabled: true, vatAccount: '1776' },
      }),
    ).toEqual({
      rzl: parseAccountingProfileSerializerParams(stored).rzl,
      marginScheme: { enabled: true, vatAccount: '1776' },
    });
  });

  it('keeps the stored VAT account when a patch only switches the margin scheme off', () => {
    expect(
      mergeAccountingProfileSerializerParams(
        { marginScheme: { enabled: true, vatAccount: '1776' } },
        { marginScheme: { enabled: false } },
      ),
    ).toEqual({ marginScheme: { enabled: false, vatAccount: '1776' } });
  });

  it('keeps the stored enabled flag when a patch only changes the VAT account', () => {
    expect(
      mergeAccountingProfileSerializerParams(
        { marginScheme: { enabled: true, vatAccount: '1776' } },
        { marginScheme: { vatAccount: '1777' } },
      ),
    ).toEqual({ marginScheme: { enabled: true, vatAccount: '1777' } });
  });

  it('clears the stored VAT account only when the patch sends null for it', () => {
    expect(
      mergeAccountingProfileSerializerParams(
        { marginScheme: { enabled: true, vatAccount: '1776' } },
        { marginScheme: { enabled: false, vatAccount: null } },
      ),
    ).toEqual({ marginScheme: { enabled: false, vatAccount: null } });
  });

  it('reads only the margin switch, so RZL or BMD blocks never fail a margin read', () => {
    expect(
      parseMarginSchemeSerializerParams({
        rzl: { steuercodes: { vat20: 5020 } },
        bmd: { steuercodes: { vat20: 5020 } },
        marginScheme: { enabled: true, vatAccount: '1776' },
      }),
    ).toEqual({ enabled: true, vatAccount: '1776' });
    expect(
      parseMarginSchemeSerializerParams({ rzl: { firmNumber: 'FN-1' } }),
    ).toBeNull();
    expect(parseMarginSchemeSerializerParams(null)).toBeNull();
  });

  it('rejects enabling the margin scheme through a patch when no VAT account is stored or sent', () => {
    expect(() =>
      mergeAccountingProfileSerializerParams(
        {},
        { marginScheme: { enabled: true } },
      ),
    ).toThrow(
      'serializerParams.marginScheme.vatAccount is required when margin export is enabled',
    );
  });
});

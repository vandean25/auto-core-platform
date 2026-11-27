import { BadRequestException } from '@nestjs/common';
import {
  SAVED_VIEW_LIST_REGISTRY,
  validateSavedViewInput,
} from './saved-views.registry.js';

describe('saved-views registry & href validation', () => {
  it('exposes /sales/invoices with invoice.read in the allowlist', () => {
    expect(SAVED_VIEW_LIST_REGISTRY['/sales/invoices']?.permission).toBe(
      'invoice.read',
    );
  });

  it('accepts a relative href whose pathname equals listPath and carries known DataTable params', () => {
    const result = validateSavedViewInput({
      listPath: '/sales/invoices',
      name: '  Offene Rechnungen  ',
      href: '/sales/invoices?filter_status=ISSUED&search=BMW&sortField=date&sortDirection=desc&pageSize=25',
    });

    expect(result).toEqual({
      listPath: '/sales/invoices',
      name: 'Offene Rechnungen',
      href: '/sales/invoices?filter_status=ISSUED&search=BMW&sortField=date&sortDirection=desc&pageSize=25',
    });
  });

  it('accepts /vehicles/pickerl-due?filter_contacted=no as a saved view href', () => {
    const result = validateSavedViewInput({
      listPath: '/vehicles/pickerl-due',
      name: 'Unkontaktiert',
      href: '/vehicles/pickerl-due?filter_contacted=no',
    });

    expect(result).toEqual({
      listPath: '/vehicles/pickerl-due',
      name: 'Unkontaktiert',
      href: '/vehicles/pickerl-due?filter_contacted=no',
    });
  });

  it.each(['/customers', '/inventory', '/workshop/orders'])(
    'accepts column visibility and density for %s',
    (listPath) => {
      const href = `${listPath}?cols=name,email_2,order.total-1&density=compact`;
      expect(
        validateSavedViewInput({ listPath, href, name: 'Layout' }).href,
      ).toBe(href);
    },
  );

  it.each(['/customers', '/vehicles'])(
    'accepts custom field filters in a saved %s view',
    (listPath) => {
      const href = `${listPath}?cols=cf.segment&cf.segment%5Bin%5D=Fleet&cf.deleted=x`;
      expect(
        validateSavedViewInput({ listPath, href, name: 'Fleet' }).href,
      ).toBe(href);
    },
  );

  it.each([
    [
      'custom field on another list',
      '/inventory',
      '/inventory?cf.segment=Fleet',
      'Fleet',
    ],
    ['unknown listPath', '/unknown/list', '/unknown/list', 'Valid Name'],
    [
      'absolute https URL',
      '/sales/invoices',
      'https://evil.example/sales/invoices',
      'Valid Name',
    ],
    [
      'protocol-relative URL',
      '/sales/invoices',
      '//evil.example/sales/invoices',
      'Valid Name',
    ],
    ['javascript: URI', '/sales/invoices', 'javascript:alert(1)', 'Valid Name'],
    [
      'pathname mismatch',
      '/sales/invoices',
      '/customers?search=test',
      'Valid Name',
    ],
    [
      'unknown query param',
      '/sales/invoices',
      '/sales/invoices?redirect=https://evil.example',
      'Valid Name',
    ],
    ['empty name', '/sales/invoices', '/sales/invoices', '   '],
    ['invalid density', '/customers', '/customers?density=huge', 'Layout'],
    [
      'duplicate density',
      '/customers',
      '/customers?density=compact&density=comfortable',
      'Layout',
    ],
    ['empty column list', '/customers', '/customers?cols=', 'Layout'],
    [
      'missing column ID',
      '/customers',
      '/customers?cols=name,,email',
      'Layout',
    ],
    [
      'invalid column ID',
      '/customers',
      '/customers?cols=name,%20email',
      'Layout',
    ],
    [
      'duplicate cols parameter',
      '/customers',
      '/customers?cols=name&cols=email',
      'Layout',
    ],
    [
      'name over 60 chars',
      '/sales/invoices',
      '/sales/invoices',
      'a'.repeat(61),
    ],
    [
      'href over 2000 chars',
      '/sales/invoices',
      `/sales/invoices?search=${'a'.repeat(2000)}`,
      'Valid Name',
    ],
  ])(
    'rejects %s with BadRequestException SAVED_VIEW_INVALID',
    (_label, listPath, href, name) => {
      let caught: unknown;
      try {
        validateSavedViewInput({ listPath, href, name });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).getResponse()).toMatchObject({
        code: 'SAVED_VIEW_INVALID',
      });
    },
  );
});

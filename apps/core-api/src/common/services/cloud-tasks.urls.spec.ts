import { describe, expect, it } from '@jest/globals';
import { InternalServerErrorException } from '@nestjs/common';
import {
  buildDocumentBrandingTaskUrl,
  buildPdfTaskUrl,
  resolveCloudTasksOidcAudience,
} from './cloud-tasks.urls.js';

describe('resolveCloudTasksOidcAudience', () => {
  it('returns the origin of the target base URL', () => {
    expect(
      resolveCloudTasksOidcAudience('https://app.example.com/api/v1'),
    ).toBe('https://app.example.com');
  });

  it('accepts a base URL that already ends with a slash', () => {
    expect(resolveCloudTasksOidcAudience('https://app.example.com/api/')).toBe(
      'https://app.example.com',
    );
  });
});

describe('buildPdfTaskUrl', () => {
  it.each([
    [
      'invoice',
      'invoice-1',
      'https://app.example.com/api/invoices/invoice-1/pdf/worker',
    ],
    [
      'workshop-order',
      'wo-1',
      'https://app.example.com/api/workshop/orders/wo-1/pdf/worker',
    ],
    [
      'workshop-estimate',
      'est-1',
      'https://app.example.com/api/workshop/estimates/est-1/pdf/worker',
    ],
    [
      'credit-note',
      'cn-1',
      'https://app.example.com/api/credit-notes/cn-1/pdf/worker',
    ],
    [
      'vehicle-sale-kaufvertrag',
      'sale-1',
      'https://app.example.com/api/vehicle-sales/sale-1/kaufvertrag/pdf/worker',
    ],
  ] as const)(
    'builds the worker URL for %s without a trailing slash on the base',
    (kind, resourceId, expected) => {
      expect(
        buildPdfTaskUrl('https://app.example.com/api', kind, resourceId),
      ).toBe(expected);
    },
  );

  it('wraps an invalid base URL with the parser message', () => {
    expect(() => buildPdfTaskUrl('not a url', 'invoice', 'invoice-1')).toThrow(
      InternalServerErrorException,
    );
    expect(() => buildPdfTaskUrl('not a url', 'invoice', 'invoice-1')).toThrow(
      /^Invalid Cloud Tasks target base URL: /,
    );
  });
});

describe('buildDocumentBrandingTaskUrl', () => {
  it('resolves the relative worker path against the base URL', () => {
    expect(
      buildDocumentBrandingTaskUrl(
        'https://app.example.com/api',
        'document-branding/assets/asset-1/worker',
      ),
    ).toBe(
      'https://app.example.com/api/document-branding/assets/asset-1/worker',
    );
  });

  it('throws a generic message for an invalid base URL', () => {
    expect(() =>
      buildDocumentBrandingTaskUrl(
        'not a url',
        'document-branding/assets/asset-1/worker',
      ),
    ).toThrow(
      new InternalServerErrorException('Invalid Cloud Tasks target base URL'),
    );
  });
});

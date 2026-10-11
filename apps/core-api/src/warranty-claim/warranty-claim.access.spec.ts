import { jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SiteContextService } from '../site/site-context.service.js';

// Access is checked before any of these is used. Their real modules (browser, fonts, storage, branding) are
// heavy to load for every run, so empty stand-ins replace them before the services are imported.
jest.unstable_mockModule('./warranty-claim-pdf.renderer.js', () => ({
  WarrantyClaimPdfRenderer: class {},
}));
jest.unstable_mockModule('../document-branding/document-branding-asset-storage.js', () => ({
  DocumentBrandingAssetStorage: class {},
}));
jest.unstable_mockModule('../invoices/invoice-snapshot-v2.helpers.js', () => ({
  resolveBrandingSnapshot: jest.fn(),
}));
jest.unstable_mockModule('../invoices/invoice-pdf-branding.helpers.js', () => ({
  brandRenderInputUnavailable: jest.fn(),
}));

const { WarrantyClaimPdfService } = await import('./warranty-claim-pdf.service.js');
const { WarrantyClaimService } = await import('./warranty-claim.service.js');

/**
 * A dependency that fails the test as soon as anything touches it. The access check must run before
 * any of them is used, so every call below has to reject without reaching the database or the site.
 */
function untouched<T>(): T {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(`dependency used before the access check: ${String(property)}`);
      },
    },
  ) as unknown as T;
}

const technician = {
  getAuthenticatedUser: () => ({ role: 'TECH' }),
} as unknown as TenantContextService;

describe('warranty claim access for technicians', () => {
  const service = new WarrantyClaimService(
    untouched<PrismaService>(),
    technician,
    untouched<SiteContextService>(),
    untouched<AuditService>(),
  );
  const pdf = new WarrantyClaimPdfService(
    untouched<PrismaService>(),
    technician,
    untouched<SiteContextService>(),
    untouched(),
    untouched(),
  );

  it.each([
    ['list', () => service.list('order-1', {})],
    ['get', () => service.get('order-1', 'claim-1')],
    ['create', () => service.create('order-1', { type: 'GARANTIE' })],
    ['update', () => service.update('order-1', 'claim-1', {})],
    ['render the PDF', () => pdf.render('order-1', 'claim-1')],
  ])('refuses to %s before it reaches any data', async (_name, call) => {
    await expect(call()).rejects.toThrow(ForbiddenException);
  });
});

import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertSiteReadAccess } from '../site/site.authorization.js';

/**
 * Roles that may read credit notes (list, detail, PDF, invoice credit-note list).
 * Every write (create, update draft, finalize, void, generate PDF) stays OWNER/ADMIN.
 */
export const CREDIT_NOTE_READ_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
]);

/**
 * Single read gate for every credit-note read route. Role first, then the site check, so a
 * TECH/DEMO caller is refused even when the note's site would otherwise be visible.
 */
export async function assertCreditNoteReadAccess(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
  siteId: string,
): Promise<void> {
  if (
    !CREDIT_NOTE_READ_ROLES.has(
      tenantContext.getAuthenticatedUser()?.role ?? '',
    )
  ) {
    throw new ForbiddenException('Tenant credit note read access is required.');
  }
  await assertSiteReadAccess(prisma, tenantContext, tenantId, siteId);
}

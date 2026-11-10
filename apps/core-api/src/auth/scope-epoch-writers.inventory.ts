/**
 * AUT-934 / ADR-0038 §2: inventoried writers of effective access scope.
 * Keep in sync with `scope-epoch-writers.spec.ts`.
 */
export const REGISTERED_SCOPE_EPOCH_WRITER_PATHS = [
  'landing-demo-access/landing-demo-access.cleanup.service.ts',
  'landing-demo-access/landing-demo-access.service.ts',
  'platform-admin/platform-admin.service.ts',
  'prisma/fixtures/clean-db.ts',
  'prisma/fixtures/demo-site-access.fixture.ts',
  'prisma/fixtures/demo-users.fixture.ts',
  'scripts/seed-landing-demo-tenant.ts',
  'scripts/seed-tenant-member.ts',
  'site/legal-entity.service.ts',
  'site/site-lifecycle.service.ts',
  'site/site-membership.service.ts',
  'tenant-member/tenant-member.service.ts',
] as const;

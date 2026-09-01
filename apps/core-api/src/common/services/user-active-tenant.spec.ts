import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE_API_ROOT = path.resolve(__dirname, '..', '..', '..');

const HELPER_PATH = path.join(
  CORE_API_ROOT,
  'src/common/services/user-active-tenant.ts',
);

/**
 * Ruling 11/50: the shared helper is the ONLY production writer of
 * `User.active_tenant_id`. Any `user.update` that sets `active_tenant_id`
 * without also setting `active_site_id` breaks the composite FK
 * `(active_tenant_id, active_site_id) → sites (tenant_id, id)`.
 *
 * This static guard scans the four live call sites and asserts none of them
 * write `active_tenant_id` directly — they must route through `setActiveTenant`.
 */
describe('active-tenant writer guard (AUT-252 / ruling 11)', () => {
  const helperSource = fs.readFileSync(HELPER_PATH, 'utf8');

  it('the shared helper atomically nulls active_site_id', () => {
    expect(helperSource).toContain('setActiveTenant');
    const updateCall = helperSource.match(/data:\s*\{[\s\S]*?\}/);
    expect(updateCall).not.toBeNull();
    expect(updateCall![0]).toContain('active_tenant_id: tenantId');
    expect(updateCall![0]).toContain('active_site_id: null');
  });

  const callSites = [
    {
      label: 'AuthSessionService.switchTenant',
      file: 'src/auth/auth-session.service.ts',
    },
    {
      label: 'AuthSessionService.ensureActiveMembership',
      file: 'src/auth/auth-session.service.ts',
    },
    {
      label: 'TenantMemberService invite auto-assign',
      file: 'src/tenant-member/tenant-member.service.ts',
    },
    {
      label: 'TenantMemberService.syncUserClaims',
      file: 'src/tenant-member/tenant-member.service.ts',
    },
  ];

  const serviceFiles = [
    path.join(CORE_API_ROOT, 'src/auth/auth-session.service.ts'),
    path.join(CORE_API_ROOT, 'src/tenant-member/tenant-member.service.ts'),
  ];

  it.each(callSites)(
    '$label routes active_tenant_id through the shared helper',
    ({ file }) => {
      const source = fs.readFileSync(path.join(CORE_API_ROOT, file), 'utf8');
      expect(source).toContain('setActiveTenant');
      expect(source).not.toMatch(/data:\s*\{\s*active_tenant_id\s*:/);
    },
  );

  it('no other production service writes active_tenant_id directly', () => {
    for (const filePath of serviceFiles) {
      const source = fs.readFileSync(filePath, 'utf8');
      // Strip the helper import/comment occurrences of the literal and look
      // for a real `data: { active_tenant_id` write shape.
      const directWrites = source.match(/data:\s*\{\s*active_tenant_id\s*:/g);
      expect(directWrites).toBeNull();
    }
  });

  it('seed and test utilities include active_site_id when writing active_tenant_id', () => {
    const seedFiles = [
      'prisma/seed.ts',
      'test/tenant-test-utils.ts',
    ];
    for (const relative of seedFiles) {
      const candidate = path.join(CORE_API_ROOT, relative);
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const source = fs.readFileSync(candidate, 'utf8');
      const writes = source.match(/active_tenant_id\s*:/g) ?? [];
      const siteWrites = source.match(/active_site_id\s*:/g) ?? [];
      if (writes.length > 0) {
        expect(siteWrites.length).toBeGreaterThanOrEqual(writes.length);
      }
    }
  });
});

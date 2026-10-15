import { TenantMemberRole } from '@prisma/client';
import { mapTenantMember } from './tenant-member.mapper.js';

describe('mapTenantMember', () => {
  it('maps a membership and its user into the API response shape', () => {
    const createdAt = new Date('2026-04-23T10:00:00.000Z');
    const updatedAt = new Date('2026-04-23T11:00:00.000Z');
    const membership = {
      id: 'membership-1',
      tenant_id: 'tenant-a',
      user_id: 'user-1',
      role: TenantMemberRole.TECH,
      is_active: false,
      createdAt,
      updatedAt,
      user: { email: 'tech@autocore.com', firstName: 'Tess', lastName: null },
    } as unknown as Parameters<typeof mapTenantMember>[0];

    expect(mapTenantMember(membership)).toStrictEqual({
      id: 'membership-1',
      tenantId: 'tenant-a',
      userId: 'user-1',
      email: 'tech@autocore.com',
      firstName: 'Tess',
      lastName: null,
      role: TenantMemberRole.TECH,
      isActive: false,
      createdAt,
      updatedAt,
    });
  });
});

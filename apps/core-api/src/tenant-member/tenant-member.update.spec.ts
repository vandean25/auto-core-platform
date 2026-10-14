import { TenantMemberRole } from '@prisma/client';
import {
  buildMembershipUpdateData,
  isSecuritySensitiveChange,
} from './tenant-member.update.js';

describe('buildMembershipUpdateData', () => {
  it('maps only the role when only the role is provided', () => {
    expect(
      buildMembershipUpdateData({ role: TenantMemberRole.TECH }),
    ).toStrictEqual({ role: TenantMemberRole.TECH });
  });

  it('maps only the active flag when only isActive is provided', () => {
    expect(buildMembershipUpdateData({ isActive: false })).toStrictEqual({
      is_active: false,
    });
  });

  it('returns an empty update when nothing is provided', () => {
    expect(buildMembershipUpdateData({})).toStrictEqual({});
  });
});

describe('isSecuritySensitiveChange', () => {
  it('flags a role that differs from the current role', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.ADMIN, {
        role: TenantMemberRole.TECH,
      }),
    ).toBe(true);
  });

  it('ignores a role that is unchanged', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.TECH, {
        role: TenantMemberRole.TECH,
      }),
    ).toBe(false);
  });

  it('flags deactivation regardless of the role', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.TECH, { isActive: false }),
    ).toBe(true);
  });

  it('does not flag reactivation or an empty update', () => {
    expect(
      isSecuritySensitiveChange(TenantMemberRole.TECH, { isActive: true }),
    ).toBe(false);
    expect(isSecuritySensitiveChange(TenantMemberRole.TECH, {})).toBe(false);
  });
});

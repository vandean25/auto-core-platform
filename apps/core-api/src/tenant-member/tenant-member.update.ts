import type { TenantMemberRole } from '@prisma/client';
import type { UpdateTenantMemberDto } from './dto/tenant-member.dto.js';

export function buildMembershipUpdateData(dto: UpdateTenantMemberDto) {
  return {
    ...(dto.role !== undefined && { role: dto.role }),
    ...(dto.isActive !== undefined && { is_active: dto.isActive }),
  };
}

export function isSecuritySensitiveChange(
  currentRole: TenantMemberRole,
  dto: UpdateTenantMemberDto,
): boolean {
  return (
    (dto.role !== undefined && dto.role !== currentRole) ||
    dto.isActive === false
  );
}

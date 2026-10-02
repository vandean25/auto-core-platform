import type { components } from '@/api/generated/openapi'

type TenantMemberRole = components['schemas']['TenantMemberRole']

export function canRecordVehicleInspection(
  activeRole: TenantMemberRole | null | undefined,
): boolean {
  return (
    activeRole === 'OWNER' ||
    activeRole === 'ADMIN' ||
    activeRole === 'SALES'
  )
}

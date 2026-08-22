import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Model delegates SystemPrisma may use. Everything else is a tenant-isolation
 * bypass and must go through PrismaService.
 *
 * - tenant, user, platformAdmin: global identity (no tenant_id)
 * - tenantMember: membership join table for auth / tenant-admin invites
 * - laborEntry: MechanicSchedulerService nightly cross-tenant close only
 * - financeSettings: PlatformAdminService tenant-provisioning bootstrap only
 * - attendanceEvent: HrAttendanceSchedulerService nightly close only
 */
export const SYSTEM_PRISMA_MODEL_DELEGATES = [
  'tenant',
  'user',
  'tenantMember',
  'platformAdmin',
  'laborEntry',
  'financeSettings',
  'attendanceEvent',
] as const;

export type SystemPrismaModelDelegate =
  (typeof SYSTEM_PRISMA_MODEL_DELEGATES)[number];

type PrismaModelDelegate = Uncapitalize<Prisma.ModelName>;

export type ForbiddenSystemPrismaDelegate = Exclude<
  PrismaModelDelegate,
  SystemPrismaModelDelegate
>;

export type SystemPrismaTransactionClient = Pick<
  PrismaClient,
  SystemPrismaModelDelegate
>;

type SystemPrismaTransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

export type SystemPrismaClient = Pick<
  PrismaClient,
  SystemPrismaModelDelegate
> & {
  $transaction<Result>(
    fn: (transaction: SystemPrismaTransactionClient) => Promise<Result>,
    options?: SystemPrismaTransactionOptions,
  ): Promise<Result>;
};

/**
 * Compile-time guard: `true` only when `T` has none of Prisma's tenant-model
 * delegates. Assign `true satisfies AssertSystemPrismaOmitsTenantModels<...>`
 * next to SystemPrismaService so a regression fails `nest build`.
 */
export type AssertSystemPrismaOmitsTenantModels<Target> =
  Extract<keyof Target, ForbiddenSystemPrismaDelegate> extends never
    ? true
    : Extract<keyof Target, ForbiddenSystemPrismaDelegate>;

export function createSystemPrismaTransactionClient(
  client: Pick<PrismaClient, SystemPrismaModelDelegate>,
): SystemPrismaTransactionClient {
  return {
    tenant: client.tenant,
    user: client.user,
    tenantMember: client.tenantMember,
    platformAdmin: client.platformAdmin,
    laborEntry: client.laborEntry,
    financeSettings: client.financeSettings,
    attendanceEvent: client.attendanceEvent,
  };
}

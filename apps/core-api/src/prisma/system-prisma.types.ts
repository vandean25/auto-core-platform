import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Model delegates SystemPrisma may use. Everything else is a tenant-isolation
 * bypass and must go through PrismaService.
 *
 * - tenant, user, platformAdmin: global identity (no tenant_id)
 * - tenantMember: membership join table for auth / tenant-admin invites
 * - laborEntry: MechanicSchedulerService nightly cross-tenant close only
 * - financeSettings, inspectionTemplate, inspectionTemplateItem, vehicleEquipmentOption: PlatformAdminService tenant-provisioning bootstrap only; writes use the new tenant ID
 * - attendanceEvent: HrAttendanceSchedulerService nightly close only
 * - agentPolicyRule: AgentPolicyService platform-default rows (tenant_id null)
 * - tenantApiKey: ApiKeyLookupService, one findUnique by key id before any tenant context exists (ADR-0026).
 *   The key row names its tenant, and every later query is tenant-scoped.
 * - workshopEstimateApprovalToken: PublicEstimateApprovalLookup, one findFirst by token hash before any tenant context
 *   exists (ADR-0025 §7). The token row names its tenant. Every later query runs through PrismaService.
 * - landingDemoAccessRequest, landingDemoSignInGrant, publicRateLimitCounter: AUT-547 public landing demo flow
 *   (before tenant context; global abuse counters).
 * - site, siteMembership: AUT-547 demo user provisioning (membership on the landing demo tenant only).
 * - notificationOutbox: AUT-547 outbox writes in the same transaction as demo access grants (tenant id on row).
 * - customerConsentUnsubscribeToken: public marketing opt-out lookup by token hash before tenant context (AUT-589).
 * - scheduledJobRun: scheduled background job execution timestamps and distributed lease claims (AUT-839).
 */
export const SYSTEM_PRISMA_MODEL_DELEGATES = [
  'tenant',
  'user',
  'tenantMember',
  'platformAdmin',
  'laborEntry',
  'financeSettings',
  'inspectionTemplate',
  'inspectionTemplateItem',
  'vehicleEquipmentOption',
  'attendanceEvent',
  'agentPolicyRule',
  'tenantApiKey',
  'workshopEstimateApprovalToken',
  'landingDemoAccessRequest',
  'landingDemoSignInGrant',
  'publicRateLimitCounter',
  'site',
  'siteMembership',
  'notificationOutbox',
  'customerConsentUnsubscribeToken',
  'scheduledJobRun',
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
    inspectionTemplate: client.inspectionTemplate,
    inspectionTemplateItem: client.inspectionTemplateItem,
    vehicleEquipmentOption: client.vehicleEquipmentOption,
    attendanceEvent: client.attendanceEvent,
    agentPolicyRule: client.agentPolicyRule,
    tenantApiKey: client.tenantApiKey,
    workshopEstimateApprovalToken: client.workshopEstimateApprovalToken,
    landingDemoAccessRequest: client.landingDemoAccessRequest,
    landingDemoSignInGrant: client.landingDemoSignInGrant,
    publicRateLimitCounter: client.publicRateLimitCounter,
    site: client.site,
    siteMembership: client.siteMembership,
    notificationOutbox: client.notificationOutbox,
    customerConsentUnsubscribeToken: client.customerConsentUnsubscribeToken,
    scheduledJobRun: client.scheduledJobRun,
  };
}

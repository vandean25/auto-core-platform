import type { Employee, EmployeeRole, TenantMemberRole } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextStorage } from '../src/common/services/tenant-context.storage';
import { randomUUID } from 'node:crypto';

export const HR_TEST_AVG_WORKDAY_MINUTES = 515;
export const HR_TEST_ANNUAL_LEAVE_MINUTES = 12875;
export const HR_TEST_WEEK_LEAVE_MINUTES = 2850;
export const HR_TEST_THREE_DAY_LEAVE_MINUTES = 1710;
export const HR_TEST_REMAINING_AFTER_WEEK_MINUTES = 10025;
export const HR_TEST_ALLOWANCE_30_MINUTES = 15450;
export const HR_TEST_CARRYOVER_5_MINUTES = 2575;

const DEFAULT_SCHEDULE_DAYS = [
  {
    weekday: 1,
    is_working: true,
    start_time: '07:30',
    end_time: '17:00',
    break_minutes: 0,
  },
  {
    weekday: 2,
    is_working: true,
    start_time: '07:30',
    end_time: '17:00',
    break_minutes: 0,
  },
  {
    weekday: 3,
    is_working: true,
    start_time: '07:30',
    end_time: '17:00',
    break_minutes: 0,
  },
  {
    weekday: 4,
    is_working: true,
    start_time: '07:30',
    end_time: '17:00',
    break_minutes: 0,
  },
  {
    weekday: 5,
    is_working: true,
    start_time: '07:30',
    end_time: '17:00',
    break_minutes: 0,
  },
  {
    weekday: 6,
    is_working: true,
    start_time: '08:00',
    end_time: '12:00',
    break_minutes: 0,
  },
  {
    weekday: 7,
    is_working: false,
    start_time: null,
    end_time: null,
    break_minutes: 0,
  },
] as const;

export type TestTenantResult = {
  tenantId: string;
  firebaseUid: string;
  email: string;
  role: TenantMemberRole;
};

type TestTokenFactory = {
  createTestToken: (overrides?: {
    sub?: string;
    email?: string;
    tenantId?: string;
    role?: string;
    platformRole?: string;
    iss?: string;
  }) => string;
};

function buildTestTenantIdentity(tenantId: string) {
  return {
    userId: 'e2e-test-user',
    email: 'e2e@test.local',
    tenantId,
    role: 'ADMIN',
  } as const;
}

export function runWithTenantContext<T>(tenantId: string, fn: () => T): T {
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser(buildTestTenantIdentity(tenantId));
    return fn();
  });
}

export function createTestAuthToken(
  authService: TestTokenFactory,
  tenant: TestTenantResult,
  overrides: {
    sub?: string;
    email?: string;
    tenantId?: string;
    role?: string;
    platformRole?: string;
    iss?: string;
  } = {},
): string {
  return authService.createTestToken({
    sub: tenant.firebaseUid,
    email: tenant.email,
    tenantId: tenant.tenantId,
    role: tenant.role,
    ...overrides,
  });
}

export async function seedTestEmployee(
  prisma: PrismaService,
  params: {
    tenantId: string;
    name: string;
    role: EmployeeRole;
    isActive?: boolean;
    userId?: string | null;
    annualLeaveMinutes?: number;
    hiredOn?: Date;
    sortOrder?: number;
  },
): Promise<Employee> {
  const annualLeaveMinutes =
    params.annualLeaveMinutes ?? HR_TEST_ANNUAL_LEAVE_MINUTES;
  const effectiveFrom = params.hiredOn ?? new Date();

  const employee = await prisma.employee.create({
    data: {
      tenant_id: params.tenantId,
      name: params.name,
      role: params.role,
      is_active: params.isActive ?? true,
      sort_order: params.sortOrder ?? 0,
      annual_leave_minutes: annualLeaveMinutes,
      ...(params.userId !== undefined && { user_id: params.userId }),
      ...(params.hiredOn !== undefined && { hired_on: params.hiredOn }),
    },
  });

  await prisma.employeeWorkSchedule.create({
    data: {
      tenant_id: params.tenantId,
      employee_id: employee.id,
      effective_from: effectiveFrom,
      days: {
        create: DEFAULT_SCHEDULE_DAYS.map((day) => ({
          weekday: day.weekday,
          is_working: day.is_working,
          start_time: day.start_time,
          end_time: day.end_time,
          break_minutes: day.break_minutes,
        })),
      },
    },
  });

  return employee;
}

/**
 * Resolves the tenant's MAIN site id (created by createTestTenant or the
 * backfill migration). Throws if the tenant has no site.
 */
export async function resolveTestMainSiteId(
  prisma: PrismaService,
  tenantId: string,
): Promise<string> {
  const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
  const site = await tenantPrisma.site.findFirstOrThrow({
    where: { tenant_id: tenantId, code: 'MAIN' },
    select: { id: true },
  });
  return site.id;
}

export async function seedTestTenantMember(
  prisma: PrismaService,
  params: {
    tenantId: string;
    userId: string;
    role?: TenantMemberRole;
  },
): Promise<void> {
  await prisma.user.update({
    where: { id: params.userId },
    data: {
      active_tenant_id: params.tenantId,
      memberships: {
        create: {
          tenant_id: params.tenantId,
          role: params.role ?? 'ADMIN',
          is_active: true,
        },
      },
    },
  });
}

export async function createTestPlatformAdmin(
  prisma: PrismaService,
  options: { email?: string; firebaseUid?: string } = {},
): Promise<{ userId: string; firebaseUid: string; email: string }> {
  const unique = randomUUID();
  const firebaseUid = options.firebaseUid ?? `e2e-platform-${unique}`;
  const email = options.email ?? `e2e-platform-${unique}@example.com`;

  const user = await prisma.user.create({
    data: {
      firebaseUid,
      email,
      platformAdmin: {
        create: {
          role: 'SUPER_ADMIN',
          is_active: true,
        },
      },
    },
    select: {
      id: true,
      firebaseUid: true,
      email: true,
    },
  });

  return {
    userId: user.id,
    firebaseUid: user.firebaseUid,
    email: user.email,
  };
}

export async function cleanupTestUsers(
  prisma: PrismaService,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  await prisma.platformAdmin.deleteMany({
    where: { user_id: { in: userIds } },
  });

  await Promise.all(
    userIds.map((userId) =>
      prisma.user.update({
        where: { id: userId },
        data: {
          active_tenant_id: null,
          memberships: {
            deleteMany: {},
          },
        },
      }),
    ),
  );

  await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });
}

export async function createTestTenant(
  prisma: PrismaService,
  prefix = 'e2e-tenant',
): Promise<TestTenantResult> {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const slug = `${prefix}-${unique}`;

  let tenant: { id: string };
  try {
    tenant = await prisma.tenant.create({
      data: {
        id: randomUUID(),
        name: `E2E Tenant ${unique}`,
        slug,
        plan: 'STANDARD',
        is_active: true,
      },
      select: {
        id: true,
      },
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'unknown';
    const meta =
      error && typeof error === 'object' && 'meta' in error
        ? JSON.stringify(error.meta)
        : 'null';
    throw new Error(
      `[createTestTenant] Failed to create tenant slug='${slug}' code=${code} meta=${meta}: ${details}`,
      { cause: error },
    );
  }

  const firebaseUid = `e2e-user-${tenant.id}`;
  const email = `e2e-${tenant.id}@example.com`;
  const role: TenantMemberRole = 'ADMIN';

  const createdUser = await prisma.user.create({
    data: {
      firebaseUid,
      email,
      active_tenant_id: tenant.id,
      memberships: {
        create: {
          tenant_id: tenant.id,
          role,
          is_active: true,
        },
      },
    },
    select: { id: true },
  });

  // Multi-Location foundation: one LegalEntity + one MAIN Site + membership
  // so every e2e tenant has a working site (backfill equivalent).
  const tenantPrisma = createTenantAwarePrisma(prisma, tenant.id);
  const legalEntity = await tenantPrisma.legalEntity.create({
    data: {
      tenant_id: tenant.id,
      name: `E2E GmbH ${unique}`,
      country_iso: 'AT',
      is_active: true,
    },
  });
  const site = await tenantPrisma.site.create({
    data: {
      tenant_id: tenant.id,
      legal_entity_id: legalEntity.id,
      code: 'MAIN',
      name: `E2E Site ${unique}`,
      timezone: 'Europe/Vienna',
      slot_minutes: 30,
      holiday_country_iso: 'AT',
      is_active: true,
    },
  });
  await tenantPrisma.siteMembership.create({
    data: {
      tenant_id: tenant.id,
      user_id: createdUser.id,
      site_id: site.id,
      is_active: true,
    },
  });
  await tenantPrisma.workshopOpeningHour.createMany({
    data: DEFAULT_SCHEDULE_DAYS.map((day) => ({
      tenant_id: tenant.id,
      site_id: site.id,
      weekday: day.weekday,
      is_closed: !day.is_working,
      open_time: day.start_time ?? '07:30',
      close_time: day.end_time ?? '17:00',
    })),
    skipDuplicates: true,
  });
  await tenantPrisma.storageLocation.createMany({
    data: [
      {
        tenant_id: tenant.id,
        site_id: site.id,
        code: 'TRANSIT',
        name: 'In Transit',
        type: 'in_transit',
        is_system: true,
      },
      {
        tenant_id: tenant.id,
        site_id: site.id,
        code: 'LOT',
        name: 'Vehicle Lot',
        type: 'vehicle_lot',
        is_system: false,
      },
    ],
    skipDuplicates: true,
  });
  await tenantPrisma.user.update({
    where: { id: createdUser.id },
    data: { active_site_id: site.id },
  });

  return {
    tenantId: tenant.id,
    firebaseUid,
    email,
    role,
  };
}

export async function cleanupTestTenantGraph(
  prisma: PrismaService,
  tenantId: string,
): Promise<void> {
  const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);

  await tenantPrisma.vehicleLedgerEntry.deleteMany({});
  await tenantPrisma.invoiceItem.deleteMany({});
  await tenantPrisma.invoice.deleteMany({});
  await tenantPrisma.invoiceSequence.deleteMany({});
  await tenantPrisma.vehicleSale.deleteMany({});
  await tenantPrisma.vehiclePurchase.deleteMany({});
  await tenantPrisma.purchaseInvoiceLine.deleteMany({});
  await tenantPrisma.purchaseInvoice.deleteMany({});
  await tenantPrisma.inventoryTransaction.deleteMany({});
  await tenantPrisma.inventoryStock.deleteMany({});
  await tenantPrisma.purchaseOrderItem.deleteMany({});
  await tenantPrisma.purchaseOrder.deleteMany({});
  await tenantPrisma.workshopInspectionItem.deleteMany({});
  await tenantPrisma.workshopInspection.deleteMany({});
  await tenantPrisma.workshopMedia.deleteMany({});
  await tenantPrisma.workshopTaskLineItem.deleteMany({});
  await tenantPrisma.laborEntry.deleteMany({});
  await tenantPrisma.workshopVoiceNoteDraft.deleteMany({});
  await tenantPrisma.voiceNoteRateLimit.deleteMany({});
  await tenantPrisma.workshopTask.deleteMany({});
  await tenantPrisma.workshopOrder.deleteMany({});
  await tenantPrisma.bay.deleteMany({});
  await tenantPrisma.inspectionTemplateItem.deleteMany({});
  await tenantPrisma.inspectionTemplate.deleteMany({});
  await tenantPrisma.attendanceEvent.deleteMany({});
  await tenantPrisma.leaveRequest.deleteMany({});
  await tenantPrisma.employeeLeaveBalance.deleteMany({});
  await tenantPrisma.employeeWorkScheduleDay.deleteMany({});
  await tenantPrisma.employeeWorkSchedule.deleteMany({});
  await tenantPrisma.employee.deleteMany({});
  await tenantPrisma.vehicle.deleteMany({});
  await tenantPrisma.catalogOemConcernMake.deleteMany({});
  await tenantPrisma.catalogOemConcern.deleteMany({});
  await tenantPrisma.vehicleMakeAlias.deleteMany({});
  await tenantPrisma.catalogProviderSettings.deleteMany({});
  await tenantPrisma.customer.deleteMany({});
  await tenantPrisma.catalogItem.deleteMany({});
  await tenantPrisma.vendor.deleteMany({});
  await tenantPrisma.storageLocation.deleteMany({});
  await tenantPrisma.brand.deleteMany({});
  await tenantPrisma.workshopHoliday.deleteMany({});
  await tenantPrisma.workshopOpeningHour.deleteMany({});
  await tenantPrisma.siteMembership.deleteMany({});
  await tenantPrisma.site.deleteMany({});
  await tenantPrisma.legalEntity.deleteMany({});
  await tenantPrisma.financeSettings.deleteMany({});

  const memberships = await tenantPrisma.tenantMember.findMany({
    select: { user_id: true },
  });
  const userIds = [
    ...new Set(memberships.map((membership) => membership.user_id)),
  ];
  await tenantPrisma.tenantMember.deleteMany({});
  await cleanupTestUsers(prisma, userIds);

  await prisma.$executeRawUnsafe(
    `DELETE FROM audit_logs WHERE tenant_id = $1`,
    tenantId,
  );
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

function wrapDelegateWithTenantContext<T extends object>(
  delegate: T,
  tenantId: string,
): T {
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      const member = Reflect.get(target, prop, receiver);
      if (typeof member !== 'function') {
        return member;
      }

      return (...args: unknown[]) =>
        runWithTenantContext(tenantId, async () => {
          const result = Reflect.apply(
            member as (...args: unknown[]) => unknown,
            target,
            args,
          );
          return await Promise.resolve(result);
        });
    },
  });
}

export function createTenantAwarePrisma<T extends object>(
  prisma: T,
  tenantId: string,
): T {
  const base =
    prisma &&
    typeof prisma === 'object' &&
    'client' in prisma &&
    (prisma as { client?: object }).client
      ? ((prisma as { client: object }).client as T)
      : prisma;

  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value === 'function') {
        return (...args: unknown[]) =>
          runWithTenantContext(tenantId, async () => {
            const result = Reflect.apply(
              value as (...args: unknown[]) => unknown,
              target,
              args,
            );
            return await Promise.resolve(result);
          });
      }

      if (value && typeof value === 'object') {
        return wrapDelegateWithTenantContext(value as object, tenantId);
      }

      return value;
    },
  });
}

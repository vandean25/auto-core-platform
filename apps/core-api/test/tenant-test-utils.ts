import type { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextStorage } from '../src/common/services/tenant-context.storage';
import { randomUUID } from 'node:crypto';

type TestTenantResult = {
  tenantId: string;
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
    );
  }

  return { tenantId: tenant.id };
}

export async function cleanupTestTenantGraph(
  prisma: PrismaService,
  tenantId: string,
): Promise<void> {
  const tenantPrisma = createTenantAwarePrisma(
    prisma,
    tenantId,
  ) as PrismaService;

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
  await tenantPrisma.workshopTask.deleteMany({});
  await tenantPrisma.workshopOrder.deleteMany({});
  await tenantPrisma.inspectionTemplateItem.deleteMany({});
  await tenantPrisma.inspectionTemplate.deleteMany({});
  await tenantPrisma.employee.deleteMany({});
  await tenantPrisma.vehicle.deleteMany({});
  await tenantPrisma.customer.deleteMany({});
  await tenantPrisma.catalogItem.deleteMany({});
  await tenantPrisma.vendor.deleteMany({});
  await tenantPrisma.storageLocation.deleteMany({});
  await tenantPrisma.brand.deleteMany({});
  await tenantPrisma.financeSettings.deleteMany({});
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

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { CustomerConsentService } from '../customer-consent/customer-consent.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TyreStorageService } from '../tyre-storage/tyre-storage.service.js';
import type { VehicleStockQueryService } from '../vehicle-stock/vehicle-stock-query.service.js';
import type { WarrantyClaimService } from '../warranty-claim/warranty-claim.service.js';
import { McpComplianceReadService } from './mcp-compliance-read.service.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

function build(options: {
  role?: string;
  customerExists?: boolean;
}) {
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_A),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: options.role ?? 'SALES',
      userId: 'firebase-uid',
      tenantId: TENANT_A,
    }),
  };
  const prisma = {
    customer: {
      findFirst: jest.fn().mockResolvedValue(
        options.customerExists === false ? null : { id: CUSTOMER_ID },
      ),
    },
  };
  const customerConsent = {
    evaluateCanContactForCustomer: jest.fn().mockResolvedValue({
      allowed: false,
      reason: 'MARKETING_PERMISSION_MISSING',
    }),
  };
  const vehicleStock = {
    listGewaehrleistungDue: jest.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, pageSize: 0, pageCount: 0 },
    }),
  };
  const tyreStorage = {
    list: jest.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, pageSize: 10, pageCount: 0 },
    }),
    listDueForSwap: jest.fn().mockResolvedValue({ data: [] }),
    findByVehicle: jest.fn().mockResolvedValue({ data: [] }),
  };
  const warrantyClaims = {
    listAtActiveSite: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
  };

  const service = new McpComplianceReadService(
    tenantContext as unknown as TenantContextService,
    prisma as unknown as PrismaService,
    customerConsent as unknown as CustomerConsentService,
    vehicleStock as unknown as VehicleStockQueryService,
    tyreStorage as unknown as TyreStorageService,
    warrantyClaims as unknown as WarrantyClaimService,
  );

  return {
    service,
    tenantContext,
    prisma,
    customerConsent,
    vehicleStock,
    tyreStorage,
    warrantyClaims,
  };
}

describe('McpComplianceReadService.checkContactPermission', () => {
  it('returns allowed and reason without ledger fields', async () => {
    const { service, customerConsent } = build({});

    const result = await service.checkContactPermission({
      customer_id: CUSTOMER_ID,
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
    });

    expect(result).toEqual({
      customer_id: CUSTOMER_ID,
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      allowed: false,
      reason: 'MARKETING_PERMISSION_MISSING',
    });
    expect(customerConsent.evaluateCanContactForCustomer).toHaveBeenCalledWith(
      CUSTOMER_ID,
      'EMAIL',
      'NEWSLETTER',
      undefined,
    );
    expect(result).not.toHaveProperty('text_snapshot');
  });

  it('rejects TECH callers like the consent ledger REST API', async () => {
    const { service } = build({ role: 'TECH' });

    await expect(
      service.checkContactPermission({
        customer_id: CUSTOMER_ID,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns not found when the customer is outside the tenant', async () => {
    const { service } = build({ customerExists: false });

    await expect(
      service.checkContactPermission({
        customer_id: CUSTOMER_ID,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('McpComplianceReadService.listGewaehrleistungDue', () => {
  it('passes endsWithinDays to the stock query service', async () => {
    const { service, vehicleStock } = build({});

    await service.listGewaehrleistungDue({ within_days: 90, pageSize: 5 });

    expect(vehicleStock.listGewaehrleistungDue).toHaveBeenCalledWith({
      endsWithinDays: 90,
    });
  });

  it('returns an empty page when nothing is due', async () => {
    const { service } = build({});

    const result = await service.listGewaehrleistungDue({});

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.next_cursor).toBeNull();
  });
});

describe('McpComplianceReadService.listTyreSets', () => {
  it('uses listDueForSwap when due_for_swap is true', async () => {
    const { service, tyreStorage } = build({});

    await service.listTyreSets({ due_for_swap: true });

    expect(tyreStorage.listDueForSwap).toHaveBeenCalled();
    expect(tyreStorage.list).not.toHaveBeenCalled();
  });
});

describe('McpComplianceReadService.listWarrantyClaims', () => {
  it('scopes through the warranty claim service', async () => {
    const { service, warrantyClaims } = build({});

    await service.listWarrantyClaims({ status: 'DRAFT', pageSize: 10 });

    expect(warrantyClaims.listAtActiveSite).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['DRAFT'],
        pageSize: 10,
      }),
    );
  });

  it('rejects TECH callers', async () => {
    const { service, warrantyClaims } = build({ role: 'TECH' });

    await expect(service.listWarrantyClaims({})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(warrantyClaims.listAtActiveSite).not.toHaveBeenCalled();
  });
});

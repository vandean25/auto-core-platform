import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WorkshopEstimateService } from './workshop-estimate.service.js';

const SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';

function buildService(role: string | undefined) {
  const tx = {
    workshopOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    workshopEstimateVersion: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    workshopOrder: tx.workshopOrder,
    workshopEstimateVersion: tx.workshopEstimateVersion,
    workshopEstimate: { findFirst: jest.fn().mockResolvedValue(null) },
    workshopEstimateSequence: { upsert: jest.fn() },
    financeSettings: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const tenantContext = {
    getAuthenticatedUser: jest.fn().mockReturnValue(role ? { role } : undefined),
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue('site-1'),
  };
  const pdf = {
    requestGeneration: jest.fn(),
    getPdf: jest.fn(),
  };
  const service = new WorkshopEstimateService(
    prisma as never,
    tenantContext as never,
    siteContext as never,
    pdf as never,
  );
  return { service, prisma, tenantContext, pdf };
}

describe('WorkshopEstimateService access and send gating', () => {
  const previousFlag = process.env[SEND_FLAG];

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env[SEND_FLAG];
    } else {
      process.env[SEND_FLAG] = previousFlag;
    }
  });

  it.each([
    ['create', (service: WorkshopEstimateService) => service.createForOrder('order-1')],
    ['list', (service: WorkshopEstimateService) => service.listForOrder('order-1')],
    ['revise', (service: WorkshopEstimateService) => service.createRevision('order-1')],
    ['read', (service: WorkshopEstimateService) => service.getVersion('version-1')],
    ['send', (service: WorkshopEstimateService) => service.sendVersion('version-1')],
    ['request pdf', (service: WorkshopEstimateService) => service.requestVersionPdf('version-1')],
    ['download pdf', (service: WorkshopEstimateService) => service.getVersionPdf('version-1')],
  ])('refuses a TECH session on %s without touching the database', async (_name, call) => {
    process.env[SEND_FLAG] = 'true';
    const { service, prisma, pdf } = buildService('TECH');

    await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.workshopEstimate.findFirst).not.toHaveBeenCalled();
    expect(pdf.requestGeneration).not.toHaveBeenCalled();
    expect(pdf.getPdf).not.toHaveBeenCalled();
  });

  it('keeps sending closed while the legal copy is unapproved (503, no transaction)', async () => {
    delete process.env[SEND_FLAG];
    const { service, prisma } = buildService('ADMIN');

    const error = await service.sendVersion('version-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'ESTIMATE_SEND_DISABLED',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reports a missing version as not found once sending is enabled', async () => {
    process.env[SEND_FLAG] = 'true';
    const { service, prisma } = buildService('ADMIN');

    await expect(service.sendVersion('version-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('consumes no KV number when the order is not in the active site scope', async () => {
    const { service, prisma } = buildService('OWNER');
    prisma.workshopOrder.findFirst.mockResolvedValue(null);

    await expect(service.createForOrder('order-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.workshopEstimateSequence.upsert).not.toHaveBeenCalled();
  });
});

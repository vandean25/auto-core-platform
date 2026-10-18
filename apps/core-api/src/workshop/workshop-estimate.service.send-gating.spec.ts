import { NotFoundException } from '@nestjs/common';
import {
  SEND_FLAG,
  buildWorkshopEstimateGatingHarness,
  expectEstimateServiceUnavailable,
  restoreSendFlag,
} from './workshop-estimate.service.spec.support.js';

describe('WorkshopEstimateService send gating', () => {
  const previousFlag = process.env[SEND_FLAG];

  afterEach(() => {
    restoreSendFlag(previousFlag);
  });

  it('keeps sending closed while the legal copy is unapproved (503, no transaction)', async () => {
    delete process.env[SEND_FLAG];
    const { service, prisma } = buildWorkshopEstimateGatingHarness('ADMIN');

    const error = await service
      .sendVersion('version-1')
      .catch((e: unknown) => e);

    expectEstimateServiceUnavailable(error, 'ESTIMATE_SEND_DISABLED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an emailed send when the approval link base is not configured (503, no transaction)', async () => {
    process.env[SEND_FLAG] = 'true';
    const previousBase = process.env.ESTIMATE_APPROVAL_BASE_URL;
    delete process.env.ESTIMATE_APPROVAL_BASE_URL;
    const { service, prisma } = buildWorkshopEstimateGatingHarness('ADMIN');

    try {
      const error = await service
        .sendVersion('version-1', { notifyCustomerByEmail: true })
        .catch((e: unknown) => e);

      expectEstimateServiceUnavailable(error, 'ESTIMATE_APPROVAL_LINK_UNAVAILABLE');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    } finally {
      if (previousBase === undefined) {
        delete process.env.ESTIMATE_APPROVAL_BASE_URL;
      } else {
        process.env.ESTIMATE_APPROVAL_BASE_URL = previousBase;
      }
    }
  });

  it('reports a missing version as not found once sending is enabled', async () => {
    process.env[SEND_FLAG] = 'true';
    const { service, prisma } = buildWorkshopEstimateGatingHarness('ADMIN');

    await expect(service.sendVersion('version-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

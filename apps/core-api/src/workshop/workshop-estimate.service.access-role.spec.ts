import { ForbiddenException } from '@nestjs/common';
import { WorkshopEstimateService } from './workshop-estimate.service.js';
import {
  SEND_FLAG,
  buildWorkshopEstimateGatingHarness,
  restoreSendFlag,
} from './workshop-estimate.service.spec.support.js';

describe('WorkshopEstimateService role access', () => {
  const previousFlag = process.env[SEND_FLAG];

  afterEach(() => {
    restoreSendFlag(previousFlag);
  });

  it.each([
    [
      'create',
      (service: WorkshopEstimateService) => service.createForOrder('order-1'),
    ],
    [
      'list',
      (service: WorkshopEstimateService) => service.listForOrder('order-1'),
    ],
    [
      'revise',
      (service: WorkshopEstimateService) => service.createRevision('order-1'),
    ],
    [
      'read',
      (service: WorkshopEstimateService) => service.getVersion('version-1'),
    ],
    [
      'send',
      (service: WorkshopEstimateService) => service.sendVersion('version-1'),
    ],
    [
      'request pdf',
      (service: WorkshopEstimateService) =>
        service.requestVersionPdf('version-1'),
    ],
    [
      'download pdf',
      (service: WorkshopEstimateService) => service.getVersionPdf('version-1'),
    ],
    [
      'communications',
      (service: WorkshopEstimateService) =>
        service.listCommunicationsForOrder('order-1'),
    ],
  ])(
    'refuses a TECH session on %s without touching the database',
    async (_name, call) => {
      process.env[SEND_FLAG] = 'true';
      const { service, prisma, pdf } = buildWorkshopEstimateGatingHarness('TECH');

      await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.workshopEstimate.findFirst).not.toHaveBeenCalled();
      expect(pdf.requestGeneration).not.toHaveBeenCalled();
      expect(pdf.getPdf).not.toHaveBeenCalled();
    },
  );
});

import { NotFoundException } from '@nestjs/common';
import { buildWorkshopEstimateGatingHarness } from './workshop-estimate.service.spec.support.js';

describe('WorkshopEstimateService create scope', () => {
  it('consumes no KV number when the order is not in the active site scope', async () => {
    const { service, prisma } = buildWorkshopEstimateGatingHarness('OWNER');
    prisma.workshopOrder.findFirst.mockResolvedValue(null);

    await expect(service.createForOrder('order-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.workshopEstimateSequence.upsert).not.toHaveBeenCalled();
  });
});

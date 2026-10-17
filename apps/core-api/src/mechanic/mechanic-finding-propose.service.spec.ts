import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MechanicFindingProposeService } from './mechanic-finding-propose.service.js';

const ORDER_ID = '51500000-0000-4000-8000-000000000601';
const TASK_ID = '51500000-0000-4000-8000-000000000602';
const FOREIGN_MEDIA_ID = '51500000-0000-4000-8000-000000000603';

describe('MechanicFindingProposeService', () => {
  const mockPrisma = {
    site: { findFirst: jest.fn() },
    workshopTask: { findFirst: jest.fn() },
    workshopMedia: { findMany: jest.fn() },
    workshopOrder: { findFirst: jest.fn() },
  };
  const mockTenant = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
  const mockSite = { getSiteId: jest.fn().mockResolvedValue('site-1') };

  let service: MechanicFindingProposeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MechanicFindingProposeService(
      mockPrisma as never,
      mockTenant as never,
      mockSite as never,
    );
  });

  it('rejects foreign media ids for the task', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: TASK_ID,
      status: 'IN_PROGRESS',
      line_items_version: 0,
      workshop_order: {
        id: ORDER_ID,
        status: 'IN_PROGRESS',
        purpose: 'CUSTOMER_REPAIR',
        site_id: 'site-1',
      },
    });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([]);

    await expect(
      service.buildPreview({
        workshop_order_id: ORDER_ID,
        workshop_task_id: TASK_ID,
        description: 'brake pads worn below limit',
        media_ids: [FOREIGN_MEDIA_ID],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects tasks at another site as not found', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue(null);

    await expect(
      service.buildPreview({
        workshop_order_id: ORDER_ID,
        workshop_task_id: TASK_ID,
        description: 'brake pads worn below limit',
        media_ids: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

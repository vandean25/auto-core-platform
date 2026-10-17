import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MechanicFindingProposeService } from './mechanic-finding-propose.service.js';

const ORDER_ID = '51500000-0000-4000-8000-000000000601';
const TASK_ID = '51500000-0000-4000-8000-000000000602';
const FOREIGN_MEDIA_ID = '51500000-0000-4000-8000-000000000603';
const MEDIA_ID = '51500000-0000-4000-8000-000000000604';

function storedMcpPayload(lineItemsVersion: number) {
  return {
    workshop_order_id: ORDER_ID,
    workshop_task_id: TASK_ID,
    site_id: 'site-1',
    finding: {
      text: 'brake pads worn below limit',
      media: [
        {
          id: MEDIA_ID,
          mime_type: 'image/jpeg',
          caption: null,
        },
      ],
      line_items_version: lineItemsVersion,
      proposed_line_items: [],
    },
  };
}

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

  it('applyAcknowledgment rejects when pinned media was deleted after propose', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: TASK_ID,
      status: 'IN_PROGRESS',
      line_items_version: 2,
      workshop_order: {
        id: ORDER_ID,
        status: 'IN_PROGRESS',
        purpose: 'CUSTOMER_REPAIR',
        site_id: 'site-1',
      },
    });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: 'IN_PROGRESS',
      purpose: 'CUSTOMER_REPAIR',
    });

    await expect(
      service.applyAcknowledgment(storedMcpPayload(2), { site_id: 'site-1' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('applyAcknowledgment rejects when line_items_version changed after propose', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: TASK_ID,
      status: 'IN_PROGRESS',
      line_items_version: 5,
      workshop_order: {
        id: ORDER_ID,
        status: 'IN_PROGRESS',
        purpose: 'CUSTOMER_REPAIR',
        site_id: 'site-1',
      },
    });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([
      {
        id: MEDIA_ID,
        mime_type: 'image/jpeg',
        caption: null,
        storage_key: 'uploads/key',
      },
    ]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: 'IN_PROGRESS',
      purpose: 'CUSTOMER_REPAIR',
    });

    await expect(
      service.applyAcknowledgment(storedMcpPayload(2), { site_id: 'site-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('applyAcknowledgment succeeds when pinned state still matches', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: TASK_ID,
      status: 'IN_PROGRESS',
      line_items_version: 2,
      workshop_order: {
        id: ORDER_ID,
        status: 'IN_PROGRESS',
        purpose: 'CUSTOMER_REPAIR',
        site_id: 'site-1',
      },
    });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([
      {
        id: MEDIA_ID,
        mime_type: 'image/jpeg',
        caption: null,
        storage_key: 'uploads/key',
      },
    ]);
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: 'IN_PROGRESS',
      purpose: 'CUSTOMER_REPAIR',
    });

    await expect(
      service.applyAcknowledgment(storedMcpPayload(2), { site_id: 'site-1' }),
    ).resolves.toMatchObject({
      workshop_order_id: ORDER_ID,
      workshop_task_id: TASK_ID,
    });
  });
});

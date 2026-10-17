import { UnprocessableEntityException } from '@nestjs/common';
import { enrichMechanicFindingSubmitPayload } from './agent-proposal-mechanic-finding-enrich.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';

const ORDER_ID = '51500000-0000-4000-8000-000000000601';
const TASK_ID = '51500000-0000-4000-8000-000000000602';
const FOREIGN_MEDIA_ID = '51500000-0000-4000-8000-000000000603';

describe('enrichMechanicFindingSubmitPayload', () => {
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
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: TASK_ID,
      status: 'IN_PROGRESS',
      line_items_version: 1,
      workshop_order: {
        id: ORDER_ID,
        status: 'IN_PROGRESS',
        purpose: 'CUSTOMER_REPAIR',
        site_id: 'site-1',
      },
    });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([]);
  });

  it('normalizes MCP-shaped submit input into stored finding.text payload', async () => {
    const normalized = await enrichMechanicFindingSubmitPayload(service, {
      workshop_order_id: ORDER_ID,
      workshop_task_id: TASK_ID,
      description: 'brake pads worn below limit',
      media_ids: [],
    });

    const record = normalized as Record<string, unknown>;
    const finding = record.finding as Record<string, unknown>;
    expect(finding.text).toBe('brake pads worn below limit');
    expect(record.workshop_order_id).toBe(ORDER_ID);
  });

  it('validates media even when submit body includes a prebuilt finding object', async () => {
    await expect(
      enrichMechanicFindingSubmitPayload(service, {
        workshop_order_id: ORDER_ID,
        workshop_task_id: TASK_ID,
        finding: {
          text: 'leaking coolant',
          media: [
            {
              id: FOREIGN_MEDIA_ID,
              mime_type: 'image/jpeg',
              caption: null,
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

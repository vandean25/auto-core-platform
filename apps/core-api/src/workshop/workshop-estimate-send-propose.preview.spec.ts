import './workshop-estimate-send-propose.preview-install.js';
import { WorkshopEstimateSendProposeService } from './workshop-estimate-send-propose.service.js';

const RAW_EMAIL = 'kva.recipient@example.com';
const TENANT_ID = '00000000-0000-4000-8000-000000000101';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000102';
const SITE_ID = '00000000-0000-4000-8000-000000000103';
const ORDER_ID = '00000000-0000-4000-8000-000000000104';

describe('WorkshopEstimateSendProposeService previewSend', () => {
  const mockEstimates = {
    createDraft: jest.fn(),
    createRevision: jest.fn(),
    sendVersion: jest.fn(),
  };

  const service = new WorkshopEstimateSendProposeService(
    {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      site: {
        findFirst: jest.fn().mockResolvedValue({ id: SITE_ID }),
      },
      workshopOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          site_id: SITE_ID,
          customer: {
            id: CUSTOMER_ID,
            contact_email_ok: true,
            email: RAW_EMAIL,
          },
          vehicle: { make: 'VW', model: 'Golf' },
          tasks: [
            {
              line_items: [
                {
                  id: 'line-1',
                  type: 'LABOR',
                  item_no: 'L1',
                  description: 'Labor',
                  quantity: 1,
                  unit_price: 50,
                  part_execution_status: null,
                },
              ],
            },
          ],
        }),
      },
      workshopEstimate: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      workshopEstimateVersion: {
        findFirst: jest.fn(),
      },
    } as never,
    {
      getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        role: 'ADMIN',
        userId: 'firebase-uid-1',
      }),
    } as never,
    {
      getSiteId: jest.fn().mockResolvedValue(SITE_ID),
    } as never,
    mockEstimates as never,
  );

  it('plans the send without calling estimates.sendVersion', async () => {
    const enriched = await service.enrichInput({
      workshop_order_id: ORDER_ID,
      channel: 'email',
    });
    const preview = await service.previewSend(enriched, { site_id: SITE_ID });
    expect(mockEstimates.sendVersion).not.toHaveBeenCalled();
    expect(preview).toMatchObject({
      workshop_order_id: ORDER_ID,
      site_id: SITE_ID,
      channel: 'email',
      estimate_version_id: expect.any(String),
    });
  });
});

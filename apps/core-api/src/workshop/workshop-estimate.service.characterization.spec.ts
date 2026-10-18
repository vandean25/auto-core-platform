import { jest } from '@jest/globals';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopEstimateStatus } from '@prisma/client';
import {
  buildWorkshopEstimateServiceHarness,
  draftVersionRow,
  HARNESS_ESTIMATE_ID,
  HARNESS_ORDER_ID,
  HARNESS_VERSION_ID,
  laborLineOrder,
  readyAtLegalEntity,
} from './workshop-estimate.service.harness.js';

const SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';

jest.mock('./workshop-task.helpers.js', () => ({
  lockWorkshopRows: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../common/i18n/customer-document-language.js', () => ({
  loadTenantDefaultLocale: jest.fn().mockResolvedValue('de'),
  resolveCustomerDocumentLanguage: jest.fn().mockReturnValue('de'),
}));

type Harness = ReturnType<typeof buildWorkshopEstimateServiceHarness>;

describe('WorkshopEstimateService characterization', () => {
  const previousSendFlag = process.env[SEND_FLAG];

  afterEach(() => {
    if (previousSendFlag === undefined) {
      delete process.env[SEND_FLAG];
    } else {
      process.env[SEND_FLAG] = previousSendFlag;
    }
  });

  describe('sendVersion', () => {
    beforeEach(() => {
      process.env[SEND_FLAG] = 'true';
    });

    function wireSendSuccess(harness: Harness) {
      const order = laborLineOrder();
      harness.tx.workshopEstimateVersion.findFirst
        .mockResolvedValueOnce(draftVersionRow())
        .mockResolvedValueOnce({
          ...draftVersionRow(),
          status: WorkshopEstimateStatus.SENT,
          sent_at: new Date('2026-10-10T08:00:00.000Z'),
          valid_from: new Date('2026-10-10T08:00:00.000Z'),
          valid_until: new Date('2026-10-24T08:00:00.000Z'),
          total_net: new Prisma.Decimal('160.00'),
          total_tax: new Prisma.Decimal('32.00'),
          total_gross: new Prisma.Decimal('192.00'),
          snapshot_sha256: 'abc',
          legal_text_version: 'kv-legal-de-v1',
          retain_until: new Date('2027-10-10T08:00:00.000Z'),
          legal_hold: false,
          pdf_generated_at: null,
          pdf_generation_error: null,
          snapshot: {},
          estimate_id: HARNESS_ESTIMATE_ID,
          estimate: {
            id: HARNESS_ESTIMATE_ID,
            estimate_number: 'KV-2026-0001',
            workshop_order_id: HARNESS_ORDER_ID,
          },
          approvals: [],
        });
      harness.tx.workshopOrder.findFirst.mockResolvedValue(order);
      harness.tx.site.findFirst.mockResolvedValue({
        legal_entity: readyAtLegalEntity(),
      });
    }

    it('rejects a non-draft version inside the transaction', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopEstimateVersion.findFirst.mockResolvedValue({
        ...draftVersionRow(),
        status: WorkshopEstimateStatus.SENT,
      });

      const error = await service
        .sendVersion(HARNESS_VERSION_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ESTIMATE_NOT_DRAFT',
      });
    });

    it('rejects send when the order has no billable lines', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopEstimateVersion.findFirst.mockResolvedValue(draftVersionRow());
      tx.workshopOrder.findFirst.mockResolvedValue({
        ...laborLineOrder(),
        tasks: [{ id: 'task-1', line_items: [] }],
      });

      const error = await service
        .sendVersion(HARNESS_VERSION_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
        { code: 'ESTIMATE_NO_LINES' },
      );
    });

    it('rejects send when the order has no customer', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopEstimateVersion.findFirst.mockResolvedValue(draftVersionRow());
      tx.workshopOrder.findFirst.mockResolvedValue({
        ...laborLineOrder(),
        customer: null,
      });

      const error = await service
        .sendVersion(HARNESS_VERSION_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
        { code: 'ESTIMATE_CUSTOMER_REQUIRED' },
      );
    });

    it('rejects send when seller identity is incomplete', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopEstimateVersion.findFirst.mockResolvedValue(draftVersionRow());
      tx.workshopOrder.findFirst.mockResolvedValue(laborLineOrder());
      tx.site.findFirst.mockResolvedValue({
        legal_entity: { ...readyAtLegalEntity(), vat_id: null },
      });

      const error = await service
        .sendVersion(HARNESS_VERSION_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
        { code: 'SELLER_IDENTITY_INCOMPLETE' },
      );
    });

    it('rejects a validity end that is not after the issue time', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopEstimateVersion.findFirst.mockResolvedValue(draftVersionRow());
      tx.workshopOrder.findFirst.mockResolvedValue(laborLineOrder());
      tx.site.findFirst.mockResolvedValue({
        legal_entity: readyAtLegalEntity(),
      });

      const error = await service
        .sendVersion(HARNESS_VERSION_ID, {
          notifyCustomerByEmail: false,
          validUntilOverride: new Date('2000-01-01T00:00:00.000Z'),
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
        { code: 'ESTIMATE_VALID_UNTIL_INVALID' },
      );
    });

    it('commits send, queues PDF best-effort, and skips customer email when not requested', async () => {
      const harness = buildWorkshopEstimateServiceHarness();
      wireSendSuccess(harness);

      const result = await harness.service.sendVersion(HARNESS_VERSION_ID);

      expect(result.status).toBe(WorkshopEstimateStatus.SENT);
      expect(harness.tx.workshopEstimateVersion.updateMany).toHaveBeenCalled();
      expect(harness.pdf.requestGeneration).toHaveBeenCalledTimes(1);
      expect(harness.wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
    });

    it('wakes the outbox worker after commit when emailing the customer', async () => {
      const harness = buildWorkshopEstimateServiceHarness();
      const previousBase = process.env.ESTIMATE_APPROVAL_BASE_URL;
      process.env.ESTIMATE_APPROVAL_BASE_URL = 'https://portal.example.at';
      wireSendSuccess(harness);

      try {
        await harness.service.sendVersion(HARNESS_VERSION_ID, {
          notifyCustomerByEmail: true,
        });
        expect(harness.outbox.enqueueInTx).toHaveBeenCalled();
        expect(harness.wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
          outboxId: 'outbox-1',
          tenantId: 'tenant-1',
        });
      } finally {
        if (previousBase === undefined) {
          delete process.env.ESTIMATE_APPROVAL_BASE_URL;
        } else {
          process.env.ESTIMATE_APPROVAL_BASE_URL = previousBase;
        }
      }
    });
  });

  describe('listForOrder', () => {
    it('returns an empty list when the order has no estimate', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopOrder.findFirst.mockResolvedValue(laborLineOrder());
      tx.workshopEstimate.findFirst.mockResolvedValue(null);

      const result = await service.listForOrder(HARNESS_ORDER_ID);

      expect(result).toEqual({ data: [] });
    });
  });

  describe('createRevision', () => {
    it('reports a missing estimate as not found', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopOrder.findFirst.mockResolvedValue(laborLineOrder());
      tx.workshopEstimate.findFirst.mockResolvedValue(null);

      await expect(service.createRevision(HARNESS_ORDER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getVersion', () => {
    it('reports a missing version as not found', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopEstimateVersion.findFirst.mockResolvedValue(null);

      await expect(service.getVersion(HARNESS_VERSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listCommunicationsForOrder', () => {
    it('returns a merged timeline for the order', async () => {
      const { service, tx } = buildWorkshopEstimateServiceHarness();
      tx.workshopOrder.findFirst.mockResolvedValue(laborLineOrder());
      tx.workshopEstimateVersion.findMany.mockResolvedValue([
        { id: HARNESS_VERSION_ID, version: 1 },
      ]);
      tx.notificationOutbox.findMany.mockResolvedValue([]);

      const result = await service.listCommunicationsForOrder(HARNESS_ORDER_ID);

      expect(result).toEqual({ data: [] });
      expect(tx.workshopEstimateVersion.findMany).toHaveBeenCalled();
    });
  });
});

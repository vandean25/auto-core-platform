import { WorkshopOrderStatus, WorkshopTaskStatus } from '@prisma/client';
import { CloudTasksService } from '../common/services/cloud-tasks.service.js';
import { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { NotificationOutboxWorkerService } from '../notifications/notification-outbox-worker.service.js';
import { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import { WeeklyReportPdfService } from '../reports/weekly-report/weekly-report-pdf.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { WorkshopEstimateService } from '../workshop/workshop-estimate.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';

const ORDER_ID = '00000000-0000-4000-8000-000000000001';
const TASK_ID = '00000000-0000-4000-8000-000000000006';
const SITE_ID = 'site-1';
const TENANT_ID = 'tenant-1';

export type AdapterLowLevelSpies = {
  generateUploadPolicy: jest.SpyInstance;
  uploadEphemeralWeeklyReportPdf: jest.Mock;
  createSignedReadUrl: jest.Mock;
  enqueuePdfGeneration: jest.SpyInstance;
  enqueueWakeUp: jest.SpyInstance;
  deliverOutbox: jest.SpyInstance;
  estimateSendVersion: jest.SpyInstance;
  estimateCreateForOrder: jest.SpyInstance;
  estimateCreateRevision: jest.SpyInstance;
  estimatePdfRequestGeneration: jest.Mock;
  outboxEnqueueInTx: jest.Mock;
  workshopMediaCreate: jest.Mock;
  assertQuiet: () => void;
  assertQuietAfterEstimateDryRun: () => void;
  restoreGlobals: () => void;
};

export type RealAdapterServices = {
  workshopMediaUploadMcp: WorkshopMediaUploadMcpService;
  weeklyReportMcp: WeeklyReportMcpService;
  workshopOrderCompletion: WorkshopOrderCompletionService;
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  spies: AdapterLowLevelSpies;
  enrichExecutorPrisma: (base: Record<string, unknown>) => Record<string, unknown>;
};

export function buildRealAdapterServices(): RealAdapterServices {
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: 'ADMIN',
      userId: 'firebase-uid-1',
      email: 'advisor@example.com',
    }),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(SITE_ID),
    listAuthorizedSiteIds: jest.fn().mockResolvedValue([SITE_ID]),
  };

  const mediaStorage = new MechanicMediaStorage();
  const generateUploadPolicy = jest.spyOn(
    mediaStorage,
    'generateUploadPolicy',
  );

  const workshopMediaCreate = jest.fn();
  const uploadEphemeralWeeklyReportPdf = jest.fn();
  const createSignedReadUrl = jest.fn();
  const estimatePdfRequestGeneration = jest.fn();
  const outboxEnqueueInTx = jest.fn();

  const enqueuePdfGeneration = jest
    .spyOn(CloudTasksService.prototype, 'enqueuePdfGeneration')
    .mockResolvedValue({ taskId: 'pdf-task' });
  const enqueueWakeUp = jest
    .spyOn(NotificationCloudTasksService.prototype, 'enqueueWakeUp')
    .mockResolvedValue(undefined);
  const deliverOutbox = jest
    .spyOn(NotificationOutboxWorkerService.prototype, 'deliver')
    .mockResolvedValue(undefined);

  const sharedPrisma = {
    site: {
      findFirst: jest.fn().mockResolvedValue({
        id: SITE_ID,
        timezone: 'Europe/Vienna',
        legal_entity: { name: 'Seller GmbH', is_ready: true },
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    employee: {
      findFirst: jest.fn().mockResolvedValue({ id: 'employee-1' }),
    },
    workshopTask: {
      findFirst: jest.fn().mockResolvedValue({
        id: TASK_ID,
        status: WorkshopTaskStatus.IN_PROGRESS,
        workshop_order_id: ORDER_ID,
        workshop_order: {
          id: ORDER_ID,
          site_id: SITE_ID,
          status: WorkshopOrderStatus.IN_PROGRESS,
          purpose: 'CUSTOMER_REPAIR',
        },
      }),
      findMany: jest.fn().mockResolvedValue([
        { id: TASK_ID, status: WorkshopTaskStatus.IN_PROGRESS },
      ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopMedia: { create: workshopMediaCreate },
    workshopOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        status: WorkshopOrderStatus.IN_PROGRESS,
        purpose: 'CUSTOMER_REPAIR',
        site_id: SITE_ID,
        order_number: 'WO-1',
        customer: {
          id: '00000000-0000-4000-8000-000000000020',
          contact_email_ok: true,
          email: 'customer@example.com',
        },
        vehicle: { make: 'VW', model: 'Golf' },
        tasks: [
          {
            id: TASK_ID,
            status: WorkshopTaskStatus.IN_PROGRESS,
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
        invoice: null,
      }),
      findFirstOrThrow: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        status: WorkshopOrderStatus.IN_PROGRESS,
        purpose: 'CUSTOMER_REPAIR',
        order_number: 'WO-1',
        customer: {
          id: '00000000-0000-4000-8000-000000000020',
          contact_email_ok: true,
          email: 'customer@example.com',
        },
        vehicle: { make: 'VW', model: 'Golf' },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    partsReservation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    workshopTaskLineItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    workshopEstimate: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    workshopEstimateVersion: {
      findFirst: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000030',
        status: 'DRAFT',
        estimate: { estimate_number: 'EST-1' },
        total_gross: '120.00',
        total_net: '100.00',
        total_tax: '20.00',
        valid_until: null,
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      fn(sharedPrisma),
    ),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const workshopMediaUploadMcp = new WorkshopMediaUploadMcpService(
    sharedPrisma as never,
    tenantContext as never,
    siteContext as never,
    mediaStorage,
  );

  const weeklyReportPdf = new WeeklyReportPdfService(
    sharedPrisma as never,
    tenantContext as never,
    siteContext as never,
    { load: jest.fn() } as never,
    { render: jest.fn() } as never,
    {
      deleteExpiredEphemeralWeeklyReports: jest.fn().mockResolvedValue(0),
      uploadEphemeralWeeklyReportPdf,
      createSignedReadUrl,
    } as never,
    { assertAllowed: jest.fn().mockResolvedValue(undefined) } as never,
  );
  const weeklyReportMcp = new WeeklyReportMcpService(weeklyReportPdf);

  const workshopOrderCompletion = new WorkshopOrderCompletionService(
    sharedPrisma as never,
    tenantContext as never,
    siteContext as never,
    {
      completeStockPrep: jest.fn().mockResolvedValue(undefined),
    } as never,
    { onOrderCompletedInTx: jest.fn().mockResolvedValue('outbox-1') } as never,
    new NotificationCloudTasksService(),
  );

  const workshopEstimates = new WorkshopEstimateService(
    sharedPrisma as never,
    tenantContext as never,
    siteContext as never,
    { requestGeneration: estimatePdfRequestGeneration } as never,
    { enqueueInTx: outboxEnqueueInTx } as never,
    new NotificationCloudTasksService(),
    { observe: jest.fn().mockResolvedValue(null) } as never,
  );
  const estimateSendVersion = jest.spyOn(workshopEstimates, 'sendVersion');
  const estimateCreateForOrder = jest.spyOn(workshopEstimates, 'createForOrder');
  const estimateCreateRevision = jest.spyOn(
    workshopEstimates,
    'createRevision',
  );

  const workshopEstimateSendPropose = new WorkshopEstimateSendProposeService(
    sharedPrisma as never,
    tenantContext as never,
    siteContext as never,
    workshopEstimates,
  );

  const spies: AdapterLowLevelSpies = {
    generateUploadPolicy,
    uploadEphemeralWeeklyReportPdf,
    createSignedReadUrl,
    enqueuePdfGeneration,
    enqueueWakeUp,
    deliverOutbox,
    estimateSendVersion,
    estimateCreateForOrder,
    estimateCreateRevision,
    estimatePdfRequestGeneration,
    outboxEnqueueInTx,
    workshopMediaCreate,
    assertQuiet: () => {
      expect(generateUploadPolicy).not.toHaveBeenCalled();
      expect(uploadEphemeralWeeklyReportPdf).not.toHaveBeenCalled();
      expect(createSignedReadUrl).not.toHaveBeenCalled();
      expect(enqueuePdfGeneration).not.toHaveBeenCalled();
      expect(enqueueWakeUp).not.toHaveBeenCalled();
      expect(deliverOutbox).not.toHaveBeenCalled();
      expect(workshopMediaCreate).not.toHaveBeenCalled();
      expect(estimateSendVersion).not.toHaveBeenCalled();
      expect(estimateCreateForOrder).not.toHaveBeenCalled();
      expect(estimateCreateRevision).not.toHaveBeenCalled();
      expect(estimatePdfRequestGeneration).not.toHaveBeenCalled();
      expect(outboxEnqueueInTx).not.toHaveBeenCalled();
    },
    assertQuietAfterEstimateDryRun: () => {
      expect(estimateSendVersion).not.toHaveBeenCalled();
      expect(estimateCreateForOrder).not.toHaveBeenCalled();
      expect(estimateCreateRevision).not.toHaveBeenCalled();
      expect(enqueuePdfGeneration).not.toHaveBeenCalled();
      expect(enqueueWakeUp).not.toHaveBeenCalled();
      expect(deliverOutbox).not.toHaveBeenCalled();
      expect(estimatePdfRequestGeneration).not.toHaveBeenCalled();
      expect(outboxEnqueueInTx).not.toHaveBeenCalled();
    },
    restoreGlobals: () => {
      generateUploadPolicy.mockRestore();
      enqueuePdfGeneration.mockRestore();
      enqueueWakeUp.mockRestore();
      deliverOutbox.mockRestore();
      estimateSendVersion.mockRestore();
      estimateCreateForOrder.mockRestore();
      estimateCreateRevision.mockRestore();
    },
  };

  return {
    workshopMediaUploadMcp,
    weeklyReportMcp,
    workshopOrderCompletion,
    workshopEstimateSendPropose,
    spies,
    enrichExecutorPrisma: (base) => ({ ...base, ...sharedPrisma }),
  };
}

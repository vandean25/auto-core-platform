import {
  WorkshopEstimateStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { WorkshopEstimateOverrunService } from './workshop-estimate-overrun.service.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';

export const HARNESS_TENANT_ID = 'tenant-1';
export const HARNESS_SITE_ID = 'site-1';
export const HARNESS_ORDER_ID = 'order-1';
export const HARNESS_VERSION_ID = 'version-1';
export const HARNESS_ESTIMATE_ID = 'estimate-1';

export function readyAtLegalEntity() {
  return {
    id: 'legal-entity-1',
    name: 'Musterwerkstatt GmbH',
    country_iso: 'AT' as const,
    address_street: 'Werkstraße 1',
    address_zip: '1010',
    address_city: 'Wien',
    vat_id: 'ATU12345678',
    tax_number: null,
    payment_terms_days: 14,
    payment_terms_text: '14 Tage netto',
    bank_iban: 'AT611904300234573201',
    bank_bic: 'BKAUATWW',
    bank_name: 'Bank',
    registry_court: null,
    registry_number: null,
    managing_directors: null,
  };
}

export function readyOrderCustomer() {
  return {
    id: 'customer-1',
    type: 'PRIVATE' as const,
    company_name: null,
    first_name: 'Anna',
    last_name: 'Beispiel',
    email: 'anna@example.test',
    phone: '+431234567',
    vat_id: null,
    address_street: 'Hauptstraße 2',
    address_city: 'Graz',
    address_zip: '8010',
    address_country: 'AT',
    contact_email_ok: true,
    preferred_language: null,
  };
}

export function laborLineOrder() {
  return {
    id: HARNESS_ORDER_ID,
    site_id: HARNESS_SITE_ID,
    status: WorkshopOrderStatus.IN_PROGRESS,
    order_number: 'WO-2026-0007',
    odometer: 98450,
    customer: readyOrderCustomer(),
    vehicle: {
      make: 'Skoda',
      model: 'Octavia',
      year: 2019,
      vin: 'VIN123',
      plate: 'W 123 AB',
    },
    tasks: [
      {
        id: 'task-1',
        line_items: [
          {
            id: 'line-1',
            type: 'LABOR',
            item_no: 'LAB-OIL',
            description: 'Ölwechsel',
            quantity: 2,
            unit_price: 80,
            part_execution_status: null,
            fitment_notes: null,
          },
        ],
      },
    ],
  };
}

export function draftVersionRow() {
  return {
    id: HARNESS_VERSION_ID,
    estimate_id: HARNESS_ESTIMATE_ID,
    version: 1,
    status: WorkshopEstimateStatus.DRAFT,
    estimate: {
      estimate_number: 'KV-2026-0001',
      workshop_order_id: HARNESS_ORDER_ID,
    },
  };
}

export type HarnessTx = {
  workshopOrder: { findFirst: jest.Mock };
  workshopEstimate: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  workshopEstimateVersion: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  workshopEstimateSequence: { upsert: jest.Mock };
  workshopEstimateBrandAssetReference: { create: jest.Mock };
  workshopEstimateApprovalToken: {
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  site: { findFirst: jest.Mock };
  tenant: { findFirst: jest.Mock };
  documentBrandProfile: { findFirst: jest.Mock };
  financeSettings: { findFirst: jest.Mock };
  notificationOutbox: { findMany: jest.Mock };
  workshopEstimateApproval: { findMany: jest.Mock };
  workshopEstimateOverrun: { findMany: jest.Mock };
  $queryRaw: jest.Mock;
};

export function createHarnessTx(): HarnessTx {
  return {
    workshopOrder: { findFirst: jest.fn() },
    workshopEstimate: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    workshopEstimateVersion: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopEstimateSequence: { upsert: jest.fn() },
    workshopEstimateBrandAssetReference: { create: jest.fn() },
    workshopEstimateApprovalToken: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    site: { findFirst: jest.fn() },
    tenant: { findFirst: jest.fn().mockResolvedValue({ default_locale: 'de' }) },
    documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    financeSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    notificationOutbox: { findMany: jest.fn().mockResolvedValue([]) },
    workshopEstimateApproval: { findMany: jest.fn().mockResolvedValue([]) },
    workshopEstimateOverrun: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

export function buildWorkshopEstimateServiceHarness(role = 'ADMIN') {
  const tx = createHarnessTx();
  const prisma = {
    $transaction: jest.fn(async (callback: (client: HarnessTx) => unknown) =>
      callback(tx),
    ),
    workshopOrder: tx.workshopOrder,
    workshopEstimate: tx.workshopEstimate,
    workshopEstimateVersion: tx.workshopEstimateVersion,
    workshopEstimateSequence: tx.workshopEstimateSequence,
    financeSettings: tx.financeSettings,
    notificationOutbox: tx.notificationOutbox,
    workshopEstimateApproval: tx.workshopEstimateApproval,
    workshopEstimateOverrun: tx.workshopEstimateOverrun,
  };
  const tenantContext = {
    getAuthenticatedUser: jest
      .fn()
      .mockReturnValue(role ? { role, userId: 'firebase-1' } : undefined),
    getTenantId: jest.fn().mockResolvedValue(HARNESS_TENANT_ID),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(HARNESS_SITE_ID),
  };
  const pdf = {
    requestGeneration: jest.fn().mockResolvedValue({ mode: 'enqueued', taskId: 't1' }),
    getPdf: jest.fn(),
  };
  const outbox = {
    enqueueInTx: jest
      .fn()
      .mockResolvedValue({ blocked: false, id: 'outbox-1', created: true }),
  };
  const wakeUps = { enqueueWakeUp: jest.fn().mockResolvedValue(undefined) };
  const overruns: Pick<WorkshopEstimateOverrunService, 'observe'> = {
    observe: jest.fn().mockResolvedValue(null),
  };
  const service = new WorkshopEstimateService(
    prisma as never,
    tenantContext as never,
    siteContext as never,
    pdf as never,
    outbox as never,
    wakeUps as never,
    overruns as never,
  );
  return { service, prisma, tx, tenantContext, pdf, outbox, wakeUps, overruns };
}

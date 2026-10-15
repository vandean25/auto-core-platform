import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { McpDocumentReadService } from './mcp-document-read.service.js';
import { encodeMcpVehicleContextCursor } from './mcp-vehicle-context.mapper.js';
import { McpVehicleContextReadService } from './mcp-vehicle-context-read.service.js';
import { encodeMcpKeysetCursor } from './mcp-output.util.js';
import { getVehicleContextInputSchema } from './mcp-tool-schemas.js';

const TENANT_ID = 'tenant-a';
const SITE_ID = 'site-a';
const VEHICLE_ID = '00000000-0000-4000-8000-0000000000d1';
const OTHER_SITE_ORDER_ID = '00000000-0000-4000-8000-0000000000e9';

describe('getVehicleContextInputSchema', () => {
  it('rejects unknown section names', () => {
    expect(() =>
      getVehicleContextInputSchema.parse({
        vehicle_id: VEHICLE_ID,
        sections: ['identity', 'free_form'],
      }),
    ).toThrow();
  });
});

describe('McpVehicleContextReadService', () => {
  let service: McpVehicleContextReadService;
  let vehicle: { findFirst: jest.Mock };
  let workshopOrder: { findMany: jest.Mock; count: jest.Mock };
  let vehicleInspectionRecord: { findMany: jest.Mock; count: jest.Mock };
  let warrantyClaim: { findMany: jest.Mock; count: jest.Mock };
  let vehicleSale: { findMany: jest.Mock; count: jest.Mock };
  let invoice: { count: jest.Mock };
  let creditNote: { count: jest.Mock };
  let siteContext: { findSiteId: jest.Mock; getSiteId: jest.Mock };
  let documentReads: { listDocuments: jest.Mock };

  beforeEach(() => {
    vehicle = {
      findFirst: jest.fn().mockResolvedValue({
        id: VEHICLE_ID,
        make: 'Testmarke',
        model: 'Modell T',
        year: 2020,
        plate: 'W-CTX 1',
        vin: 'VIN-CTX-1',
        first_registration_date: new Date('2020-01-15T00:00:00.000Z'),
        inspection_records: [],
      }),
    };
    workshopOrder = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    vehicleInspectionRecord = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    warrantyClaim = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    vehicleSale = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    invoice = { count: jest.fn().mockResolvedValue(0) };
    creditNote = { count: jest.fn().mockResolvedValue(0) };
    siteContext = {
      findSiteId: jest.fn().mockResolvedValue(SITE_ID),
      getSiteId: jest.fn().mockResolvedValue(SITE_ID),
    };
    documentReads = {
      listDocuments: jest.fn().mockResolvedValue({
        data: [],
        meta: { page_size: 10, next_cursor: null },
        truncated: false,
      }),
    };

    service = new McpVehicleContextReadService(
      {
        vehicle,
        workshopOrder,
        vehicleInspectionRecord,
        warrantyClaim,
        vehicleSale,
        invoice,
        creditNote,
      } as unknown as PrismaService,
      {
        getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      } as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
      documentReads as unknown as McpDocumentReadService,
    );
  });

  it('returns 404 for a foreign vehicle', async () => {
    vehicle.findFirst.mockResolvedValue(null);

    await expect(
      service.getVehicleContext({ vehicle_id: VEHICLE_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes open workshop orders to the active site', async () => {
    await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['open_workshop'],
    });

    expect(workshopOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_ID,
          site_id: SITE_ID,
          vehicle_id: VEHICLE_ID,
        }),
      }),
    );
  });

  it('marks operational sections unavailable without an active site', async () => {
    siteContext.findSiteId.mockResolvedValue(null);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['identity', 'open_workshop', 'documents'],
    });

    expect(result.sections.identity?.state).toBe('ok');
    expect(result.sections.open_workshop).toEqual({
      state: 'unavailable',
      reason: 'active_site_required',
      message: 'An active site is required for this section.',
    });
    expect(documentReads.listDocuments).not.toHaveBeenCalled();
  });

  it('rejects an invalid cursor before loading sections', async () => {
    await expect(
      service.getVehicleContext({
        vehicle_id: VEHICLE_ID,
        cursor: 'not-a-cursor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(workshopOrder.findMany).not.toHaveBeenCalled();
  });

  it('continues only the section encoded in the cursor', async () => {
    const cursor = encodeMcpVehicleContextCursor({
      section: 'open_workshop',
      keyset: {
        at: '2026-01-01T00:00:00.000Z',
        id: OTHER_SITE_ORDER_ID,
      },
    });

    await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['identity', 'open_workshop', 'documents'],
      cursor,
    });

    expect(workshopOrder.findMany).toHaveBeenCalled();
    expect(documentReads.listDocuments).not.toHaveBeenCalled();
    expect(vehicleInspectionRecord.findMany).not.toHaveBeenCalled();
  });

  it('wraps document list cursors with the documents section id', async () => {
    const inner = encodeMcpKeysetCursor({
      at: '2026-10-01T00:00:00.000Z',
      id: VEHICLE_ID,
    });
    documentReads.listDocuments.mockResolvedValue({
      data: [{ id: 'invoice:1', type: 'invoice' }],
      meta: { page_size: 10, next_cursor: inner },
      truncated: false,
    });
    invoice.count.mockResolvedValue(1);
    creditNote.count.mockResolvedValue(0);
    workshopOrder.count.mockResolvedValue(0);
    vehicleSale.count.mockResolvedValue(0);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['documents'],
    });

    const documents = result.sections.documents;
    expect(documents?.state).toBe('ok');
    if (documents?.state === 'ok') {
      expect(documents.meta?.next_cursor).toBe(
        encodeMcpVehicleContextCursor({
          section: 'documents',
          keyset: {
            at: '2026-10-01T00:00:00.000Z',
            id: VEHICLE_ID,
          },
        }),
      );
    }
  });

  it('does not return warranty claim text fields', async () => {
    warrantyClaim.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        workshop_order_id: '00000000-0000-4000-8000-0000000000e1',
        type: 'GEWAEHRLEISTUNG',
        status: 'DRAFT',
        claimed_amount_net: null,
        external_reference: null,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ]);
    warrantyClaim.count.mockResolvedValue(1);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['warranty_claims'],
    });

    const claims = result.sections.warranty_claims;
    expect(claims?.state).toBe('ok');
    if (claims?.state === 'ok') {
      expect(claims.data[0]).not.toHaveProperty('complaint');
      expect(claims.data[0]).not.toHaveProperty('cause_correction');
    }
  });
});

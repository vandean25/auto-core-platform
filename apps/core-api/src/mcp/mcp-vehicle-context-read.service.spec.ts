import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { McpDocumentReadService } from './mcp-document-read.service.js';
import {
  decodeMcpVehicleContextCursor,
  encodeMcpVehicleContextCursor,
} from './mcp-vehicle-context.mapper.js';
import { MCP_TOOL_RESULT_MAX_BYTES } from './mcp.constants.js';
import { capMcpToolPayload } from './mcp-output.util.js';
import { McpVehicleContextReadService } from './mcp-vehicle-context-read.service.js';
import { encodeMcpKeysetCursor } from './mcp-output.util.js';
import { getVehicleContextInputSchema } from './mcp-tool-schemas.js';
import { resolvePickerlRuleSet } from '../vehicle/pickerl/pickerl-rule-sets.js';

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

  it('rejects a cursor whose inner keyset is not a valid UUID and timestamp', () => {
    const raw = Buffer.from(
      JSON.stringify({
        section: 'open_workshop',
        keyset: { at: 'nope', id: 'x' },
      }),
      'utf8',
    ).toString('base64url');
    expect(decodeMcpVehicleContextCursor(raw)).toBeNull();
    expect(() =>
      getVehicleContextInputSchema.parse({
        vehicle_id: VEHICLE_ID,
        cursor: raw,
      }),
    ).toThrow();
  });
});

describe('McpVehicleContextReadService', () => {
  let service: McpVehicleContextReadService;
  let vehicle: { findFirst: jest.Mock };
  let workshopOrder: { findMany: jest.Mock; count: jest.Mock };
  let vehicleInspectionRecord: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
  };
  let warrantyClaim: { findMany: jest.Mock; count: jest.Mock };
  let vehicleSale: { findMany: jest.Mock; count: jest.Mock };
  let vehicleParty: { findMany: jest.Mock };
  let vehicleNotice: { findMany: jest.Mock; count: jest.Mock };
  let invoice: { count: jest.Mock };
  let creditNote: { count: jest.Mock };
  let siteContext: { findSiteId: jest.Mock; getSiteId: jest.Mock };
  let documentReads: { listDocuments: jest.Mock };
  let pickerlBarriers: { loadBarrierFlags: jest.Mock };

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
      findFirst: jest.fn().mockResolvedValue(null),
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
    vehicleParty = { findMany: jest.fn().mockResolvedValue([]) };
    vehicleNotice = {
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
    pickerlBarriers = {
      loadBarrierFlags: jest.fn().mockResolvedValue({}),
    };

    service = new McpVehicleContextReadService(
      {
        vehicle,
        workshopOrder,
        vehicleInspectionRecord,
        warrantyClaim,
        vehicleSale,
        vehicleParty,
        vehicleNotice,
        invoice,
        creditNote,
      } as unknown as PrismaService,
      {
        getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      } as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
      documentReads as unknown as McpDocumentReadService,
      pickerlBarriers as never,
    );
  });

  it('loads the active parties tenant-wide, without an active site', async () => {
    siteContext.findSiteId.mockResolvedValue(null);
    vehicleParty.findMany.mockResolvedValue([
      {
        id: 'party-1',
        role: 'OWNER',
        customer_id: 'cust-1',
        valid_from: new Date('2024-01-01T00:00:00.000Z'),
        valid_to: null,
        source: 'LEGACY_IMPORT',
        customer: {
          company_name: null,
          first_name: 'Anna',
          last_name: 'Synthetic',
        },
      },
    ]);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['parties'],
    });

    expect(result.sections.parties).toEqual({
      state: 'ok',
      data: {
        parties: [
          {
            id: 'party-1',
            role: 'OWNER',
            customer_id: 'cust-1',
            customer_name: 'Anna Synthetic',
            valid_from: '2024-01-01',
            valid_to: null,
            source: 'LEGACY_IMPORT',
          },
        ],
      },
    });
    expect(vehicleParty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_ID,
          vehicle_id: VEHICLE_ID,
        }),
      }),
    );
  });

  it('loads open service due dates and the current Pickerl due, tenant-scoped', async () => {
    vehicleNotice.findMany.mockResolvedValue([
      {
        id: 'notice-1',
        title: 'Service',
        due_date: new Date('2099-01-15T00:00:00.000Z'),
        due_mileage: 60000,
        external_ref: 'SERVICE-001',
        source: 'LEGACY_IMPORT',
      },
    ]);
    vehicleNotice.count.mockResolvedValue(1);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['due_dates'],
    });

    const section = result.sections.due_dates;
    expect(section).toMatchObject({
      state: 'ok',
      data: {
        open_service_due_total: 1,
        open_service_due: [
          {
            id: 'notice-1',
            due_date: '2099-01-15',
            due_mileage: 60000,
            external_ref: 'SERVICE-001',
          },
        ],
      },
    });
    expect(section).toHaveProperty('data.pickerl_due');
    expect(vehicleNotice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_ID,
          vehicle_id: VEHICLE_ID,
          type: 'SERVICE_DUE',
          status: 'OPEN',
        }),
      }),
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

  it('returns empty operational sections with total zero', async () => {
    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['open_workshop', 'warranty_claims', 'warranty_periods'],
    });

    expect(result.sections.open_workshop).toMatchObject({
      state: 'ok',
      data: [],
      meta: { total: 0, page_size: 10, next_cursor: null },
    });
    expect(result.sections.warranty_claims).toMatchObject({
      state: 'ok',
      data: [],
      meta: { total: 0 },
    });
    expect(result.sections.warranty_periods).toMatchObject({
      state: 'ok',
      data: [],
      meta: { total: 0 },
    });
  });

  it('scopes warranty claim and period counts to the active site', async () => {
    await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['warranty_claims', 'warranty_periods'],
    });

    expect(warrantyClaim.count).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        workshop_order: {
          tenant_id: TENANT_ID,
          site_id: SITE_ID,
          vehicle_id: VEHICLE_ID,
        },
      },
    });
    expect(vehicleSale.count).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        site_id: SITE_ID,
        vehicle_id: VEHICLE_ID,
      },
    });
  });

  it('treats a revoked site membership like missing active site for operational sections', async () => {
    siteContext.findSiteId.mockResolvedValue(null);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['warranty_claims'],
    });

    expect(result.sections.warranty_claims).toEqual({
      state: 'unavailable',
      reason: 'active_site_required',
      message: 'An active site is required for this section.',
    });
    expect(warrantyClaim.count).not.toHaveBeenCalled();
  });

  it('does not query warranty tables when the site membership is inactive', async () => {
    siteContext.findSiteId.mockResolvedValue(null);

    await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['warranty_claims', 'warranty_periods'],
    });

    expect(warrantyClaim.count).not.toHaveBeenCalled();
    expect(vehicleSale.count).not.toHaveBeenCalled();
  });

  it('loads Pickerl via one inspection row for identity without paging inspection history', async () => {
    await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['identity'],
    });

    expect(vehicleInspectionRecord.findFirst).toHaveBeenCalled();
    expect(vehicleInspectionRecord.findMany).not.toHaveBeenCalled();
  });

  it('does not load inspection history when only operational sections are requested', async () => {
    vehicle.findFirst.mockResolvedValue({
      id: VEHICLE_ID,
      make: 'Testmarke',
      model: 'Modell T',
      year: 2020,
      plate: 'W-CTX 1',
      vin: 'VIN-CTX-1',
      first_registration_date: new Date('2020-01-15T00:00:00.000Z'),
    });

    await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['warranty_claims'],
    });

    expect(vehicle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          inspection_records: expect.anything(),
        }),
      }),
    );
    expect(vehicleInspectionRecord.findMany).not.toHaveBeenCalled();
  });

  it('includes Pickerl rule bounds on inspection rows', async () => {
    const asOf = new Date('2026-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now: asOf });
    const ruleSet = resolvePickerlRuleSet(asOf);

    vehicleInspectionRecord.findMany.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        inspection_type: 'PICKERL_57A',
        inspected_on: new Date('2026-03-01T00:00:00.000Z'),
        plaketten_valid_until_year: 2028,
        plaketten_valid_until_month: 3,
        station_name: 'Pruefstelle Test',
      },
    ]);
    vehicleInspectionRecord.count.mockResolvedValue(1);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      sections: ['inspections'],
    });

    jest.useRealTimers();

    const inspections = result.sections.inspections;
    expect(inspections?.state).toBe('ok');
    if (inspections?.state === 'ok') {
      expect(inspections.data[0]).toMatchObject({
        value_source: {
          table: 'vehicle_inspection_record',
          resolved_pickerl_rule_id: ruleSet.id,
        },
        limits: {
          includes_notes: false,
          interval_years: [...ruleSet.intervalYears],
          tolerance_months_before: ruleSet.tolerance.monthsBefore,
          tolerance_months_after: ruleSet.tolerance.monthsAfter,
        },
      });
    }
  });

  it('fits a large multi-section page within the MCP byte cap', async () => {
    const rows = (prefix: string) =>
      Array.from({ length: 25 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        order_number: `${prefix}-${index}`,
        status: 'INTAKE',
        createdAt: new Date(`2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
      }));

    workshopOrder.findMany.mockResolvedValue(rows('WO'));
    workshopOrder.count.mockResolvedValue(25);
    vehicleInspectionRecord.findMany.mockResolvedValue(
      rows('INSP').map((row, index) => ({
        id: row.id,
        inspection_type: 'PICKERL_57A',
        inspected_on: row.createdAt,
        plaketten_valid_until_year: 2028,
        plaketten_valid_until_month: 3,
        station_name: `Station ${index}`,
      })),
    );
    vehicleInspectionRecord.count.mockResolvedValue(25);
    warrantyClaim.findMany.mockResolvedValue(
      rows('WC').map((row) => ({
        id: row.id,
        workshop_order_id: row.id,
        type: 'GEWAEHRLEISTUNG',
        status: 'DRAFT',
        claimed_amount_net: null,
        external_reference: null,
        createdAt: row.createdAt,
      })),
    );
    warrantyClaim.count.mockResolvedValue(25);
    vehicleSale.findMany.mockResolvedValue(
      rows('VS').map((row) => ({
        id: row.id,
        sale_number: `S-${row.order_number}`,
        contract_concluded_at: row.createdAt,
        handed_over_at: row.createdAt,
        gewaehrleistung_ends_on: row.createdAt,
        presumption_ends_on: row.createdAt,
        gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
        gewaehrleistung_shortened_negotiated: false,
        buyer_is_consumer: true,
        createdAt: row.createdAt,
      })),
    );
    vehicleSale.count.mockResolvedValue(25);
    documentReads.listDocuments.mockResolvedValue({
      data: Array.from({ length: 25 }, (_, index) => ({
        id: `invoice:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        type: 'invoice',
        name: `invoice-${index}.pdf`,
        created_at: '2026-10-01T00:00:00.000Z',
        entity: { type: 'invoice', id: VEHICLE_ID },
      })),
      meta: { page_size: 25, next_cursor: encodeMcpKeysetCursor({
        at: '2026-10-01T00:00:00.000Z',
        id: VEHICLE_ID,
      }) },
      truncated: false,
    });
    invoice.count.mockResolvedValue(25);

    const result = await service.getVehicleContext({
      vehicle_id: VEHICLE_ID,
      pageSize: 25,
    });

    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(
      MCP_TOOL_RESULT_MAX_BYTES,
    );
    const capped = capMcpToolPayload(result);
    expect(capped).not.toHaveProperty('__truncated__');
    const hasCursor = Object.values(result.sections).some(
      (section) =>
        section &&
        section.state === 'ok' &&
        'meta' in section &&
        section.meta?.next_cursor,
    );
    expect(hasCursor).toBe(true);
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

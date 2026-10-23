import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { OPEN_WORKSHOP_ORDER_STATUSES } from '../parts-requisition/parts-requisition-lifecycle.helpers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { attachPickerlDue } from '../vehicle/pickerl/attach-pickerl-due.js';
import { VehiclePickerlBarrierService } from '../vehicle/vehicle-pickerl-barrier.service.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { toGewaehrleistungReadFields } from '../vehicle-stock/vehicle-sale.warranty.js';
import { buildMcpKeysetPage, keysetCursorOf } from './mcp-audit-read.mapper.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import {
  loadMcpActiveParties,
  loadMcpOpenServiceDue,
} from './mcp-vehicle-party-context.js';
import {
  clampMcpPageSize,
  decodeMcpKeysetCursor,
  encodeMcpKeysetCursor,
  type McpKeysetCursor,
} from './mcp-output.util.js';
import {
  decodeMcpVehicleContextCursor,
  encodeMcpVehicleContextCursor,
  MCP_VEHICLE_CONTEXT_DISCLAIMER,
  MCP_VEHICLE_CONTEXT_OPERATIONAL_SECTIONS,
  MCP_VEHICLE_CONTEXT_SECTIONS,
  type McpVehicleContextPaginatedSection,
  type McpVehicleContextSection,
  toMcpOpenWorkshopRow,
  toMcpVehicleContextInspectionRow,
  toMcpWarrantyClaimContextRow,
  toMcpWarrantyPeriodRow,
} from './mcp-vehicle-context.mapper.js';
import {
  fitVehicleContextPayloadToCap,
  type VehicleContextPaginatedSectionResult,
  type VehicleContextSections,
} from './mcp-vehicle-context-fit.util.js';
import type { getVehicleContextInputSchema } from './mcp-tool-schemas.js';

type GetVehicleContextInput = z.infer<typeof getVehicleContextInputSchema>;

type SectionUnavailable = {
  state: 'unavailable';
  reason: 'active_site_required';
  message: string;
};

const ACTIVE_SITE_REQUIRED_MESSAGE =
  'An active site is required for this section.';

const DEFAULT_SECTIONS: McpVehicleContextSection[] = [
  ...MCP_VEHICLE_CONTEXT_SECTIONS,
];

function inspectionsOlderThan(cursor: McpKeysetCursor) {
  const at = new Date(cursor.at);
  return {
    OR: [
      { inspected_on: { lt: at } },
      { inspected_on: at, id: { lt: cursor.id } },
    ],
  };
}

function ordersOlderThan(cursor: McpKeysetCursor) {
  const at = new Date(cursor.at);
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
  };
}

function claimsOlderThan(cursor: McpKeysetCursor) {
  const at = new Date(cursor.at);
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
  };
}

function salesOlderThan(cursor: McpKeysetCursor) {
  const at = new Date(cursor.at);
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
  };
}

function unavailableSection(): SectionUnavailable {
  return {
    state: 'unavailable',
    reason: 'active_site_required',
    message: ACTIVE_SITE_REQUIRED_MESSAGE,
  };
}

@Injectable()
export class McpVehicleContextReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly documentReads: McpDocumentReadService,
    private readonly pickerlBarriers: VehiclePickerlBarrierService,
  ) {}

  async getVehicleContext(input: GetVehicleContextInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const asOf = new Date();
    const pageSize = clampMcpPageSize(input.pageSize);
    const requested = this.resolveSections(input.sections);
    const continuation = input.cursor
      ? decodeMcpVehicleContextCursor(input.cursor)
      : null;
    if (input.cursor && !continuation) {
      throw new BadRequestException('cursor is invalid');
    }
    if (continuation && !requested.includes(continuation.section)) {
      throw new BadRequestException(
        'cursor section is not included in sections',
      );
    }

    const shouldLoad = (section: McpVehicleContextSection) =>
      !continuation || continuation.section === section;

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: input.vehicle_id, tenant_id: tenantId },
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        plate: true,
        vin: true,
        first_registration_date: true,
      },
    });
    if (!vehicle) {
      throw new NotFoundException(
        `Vehicle with ID ${input.vehicle_id} not found`,
      );
    }

    const siteId = await this.siteContext.findSiteId();
    const sections: VehicleContextSections = {};

    if (requested.includes('identity') && shouldLoad('identity')) {
      sections.identity = {
        state: 'ok',
        data: {
          vehicle: {
            id: vehicle.id,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            plate: vehicle.plate,
            vin: vehicle.vin,
            first_registration_date: vehicle.first_registration_date
              ? vehicle.first_registration_date.toISOString().slice(0, 10)
              : null,
          },
          pickerl_due: await this.loadPickerlDue(tenantId, vehicle, asOf),
        },
      };
    }

    Object.assign(
      sections,
      await this.loadPartyAndDueSections(
        requested.filter(shouldLoad),
        tenantId,
        vehicle,
        asOf,
      ),
    );

    if (requested.includes('inspections') && shouldLoad('inspections')) {
      sections.inspections = await this.loadInspectionsSection(
        vehicle.id,
        tenantId,
        pageSize,
        asOf,
        continuation?.section === 'inspections'
          ? (continuation.keyset ?? null)
          : null,
      );
    }

    for (const operational of MCP_VEHICLE_CONTEXT_OPERATIONAL_SECTIONS) {
      if (!requested.includes(operational) || !shouldLoad(operational)) {
        continue;
      }
      if (!siteId) {
        sections[operational] = unavailableSection();
        continue;
      }
      switch (operational) {
        case 'open_workshop':
          sections.open_workshop = await this.loadOpenWorkshopSection(
            tenantId,
            siteId,
            vehicle.id,
            pageSize,
            continuation?.section === 'open_workshop'
              ? (continuation.keyset ?? null)
              : null,
          );
          break;
        case 'documents':
          sections.documents = await this.loadDocumentsSection(
            tenantId,
            siteId,
            vehicle.id,
            pageSize,
            continuation?.section === 'documents'
              ? (continuation.keyset ?? null)
              : null,
          );
          break;
        case 'warranty_claims':
          sections.warranty_claims = await this.loadWarrantyClaimsSection(
            tenantId,
            siteId,
            vehicle.id,
            pageSize,
            continuation?.section === 'warranty_claims'
              ? (continuation.keyset ?? null)
              : null,
          );
          break;
        case 'warranty_periods':
          sections.warranty_periods = await this.loadWarrantyPeriodsSection(
            tenantId,
            siteId,
            vehicle.id,
            asOf,
            pageSize,
            continuation?.section === 'warranty_periods'
              ? (continuation.keyset ?? null)
              : null,
          );
          break;
        default:
          break;
      }
    }

    return fitVehicleContextPayloadToCap({
      vehicle_id: vehicle.id,
      as_of: asOf.toISOString(),
      disclaimer: MCP_VEHICLE_CONTEXT_DISCLAIMER,
      site_id: siteId,
      sections,
    });
  }

  /** Tenant-wide `parties` and `due_dates` sections; needs no active site. Read only. */
  private async loadPartyAndDueSections(
    wanted: McpVehicleContextSection[],
    tenantId: string,
    vehicle: { id: string; first_registration_date: Date | null },
    asOf: Date,
  ): Promise<VehicleContextSections> {
    const sections: VehicleContextSections = {};
    if (wanted.includes('parties')) {
      sections.parties = {
        state: 'ok',
        data: {
          parties: await loadMcpActiveParties(
            this.prisma,
            tenantId,
            vehicle.id,
            asOf,
          ),
        },
      };
    }
    if (wanted.includes('due_dates')) {
      const openServiceDue = await loadMcpOpenServiceDue(
        this.prisma,
        tenantId,
        vehicle.id,
      );
      sections.due_dates = {
        state: 'ok',
        data: {
          pickerl_due: await this.loadPickerlDue(tenantId, vehicle, asOf),
          open_service_due_total: openServiceDue.total,
          open_service_due: openServiceDue.rows,
        },
      };
    }
    return sections;
  }

  private async loadPickerlDue(
    tenantId: string,
    vehicle: {
      id: string;
      first_registration_date: Date | null;
    },
    asOf: Date,
  ) {
    const latestInspection =
      await this.prisma.vehicleInspectionRecord.findFirst({
        where: { tenant_id: tenantId, vehicle_id: vehicle.id },
        orderBy: [{ inspected_on: 'desc' }, { id: 'desc' }],
        select: {
          inspected_on: true,
          plaketten_valid_until_year: true,
          plaketten_valid_until_month: true,
        },
      });
    const pickerl_barriers = await this.pickerlBarriers.loadBarrierFlags(
      tenantId,
      vehicle.id,
    );
    const { pickerl_due } = attachPickerlDue(
      {
        ...vehicle,
        inspection_records: latestInspection ? [latestInspection] : [],
        pickerl_barriers,
      },
      asOf,
    );
    return pickerl_due;
  }

  private resolveSections(
    sections: McpVehicleContextSection[] | undefined,
  ): McpVehicleContextSection[] {
    if (!sections || sections.length === 0) {
      return DEFAULT_SECTIONS;
    }
    const unique = [...new Set(sections)];
    return unique;
  }

  private async loadInspectionsSection(
    vehicleId: string,
    tenantId: string,
    pageSize: number,
    asOf: Date,
    cursor: McpKeysetCursor | null,
  ): Promise<VehicleContextPaginatedSectionResult> {
    const cursorWhere = cursor ? { AND: [inspectionsOlderThan(cursor)] } : {};
    const [total, records] = await Promise.all([
      this.prisma.vehicleInspectionRecord.count({
        where: { tenant_id: tenantId, vehicle_id: vehicleId },
      }),
      this.prisma.vehicleInspectionRecord.findMany({
        where: {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          ...cursorWhere,
        },
        orderBy: [{ inspected_on: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: {
          id: true,
          inspection_type: true,
          inspected_on: true,
          plaketten_valid_until_year: true,
          plaketten_valid_until_month: true,
          station_name: true,
        },
      }),
    ]);

    const page = buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.inspected_on, record.id),
      mapRow: (record) => toMcpVehicleContextInspectionRow(record, asOf),
    });

    return {
      state: 'ok',
      data: page.data,
      meta: {
        total,
        page_size: page.meta.page_size,
        next_cursor: this.wrapSectionCursor(
          'inspections',
          page.meta.next_cursor,
        ),
      },
      truncated: page.truncated,
      incomplete: page.meta.next_cursor !== null,
    };
  }

  private async loadOpenWorkshopSection(
    tenantId: string,
    siteId: string,
    vehicleId: string,
    pageSize: number,
    cursor: McpKeysetCursor | null,
  ): Promise<VehicleContextPaginatedSectionResult> {
    const baseWhere: Prisma.WorkshopOrderWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: vehicleId,
      status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
    };
    const cursorWhere = cursor ? { AND: [ordersOlderThan(cursor)] } : {};
    const [total, records] = await Promise.all([
      this.prisma.workshopOrder.count({ where: baseWhere }),
      this.prisma.workshopOrder.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: vehicleId,
          status: { in: [...OPEN_WORKSHOP_ORDER_STATUSES] },
          ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: {
          id: true,
          order_number: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    const page = buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.createdAt, record.id),
      mapRow: toMcpOpenWorkshopRow,
    });

    return {
      state: 'ok',
      data: page.data,
      meta: {
        total,
        page_size: page.meta.page_size,
        next_cursor: this.wrapSectionCursor(
          'open_workshop',
          page.meta.next_cursor,
        ),
      },
      truncated: page.truncated,
      incomplete: page.meta.next_cursor !== null,
    };
  }

  private async loadDocumentsSection(
    tenantId: string,
    siteId: string,
    vehicleId: string,
    pageSize: number,
    cursor: McpKeysetCursor | null,
  ): Promise<VehicleContextPaginatedSectionResult> {
    const [documents, total] = await Promise.all([
      this.documentReads.listDocuments({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        pageSize,
        cursor: cursor ? encodeMcpKeysetCursor(cursor) : undefined,
      }),
      this.countVehicleDocuments(tenantId, siteId, vehicleId),
    ]);

    return {
      state: 'ok',
      data: documents.data,
      meta: {
        total,
        page_size: documents.meta.page_size,
        next_cursor: this.wrapSectionCursor(
          'documents',
          documents.meta.next_cursor,
        ),
      },
      truncated: documents.truncated,
      incomplete: documents.meta.next_cursor !== null,
    };
  }

  private async countVehicleDocuments(
    tenantId: string,
    siteId: string,
    vehicleId: string,
  ): Promise<number> {
    const pdfReady = [
      {
        OR: [
          { pdf_archive_key: { not: null } },
          { pdf_storage_key: { not: null } },
        ],
      },
      { pdf_generated_at: { not: null } },
    ];
    const [invoices, creditNotes, workshopOrders, sales] = await Promise.all([
      this.prisma.invoice.count({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: vehicleId,
          AND: pdfReady,
        },
      }),
      this.prisma.creditNote.count({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          pdf_storage_key: { not: null },
          pdf_generated_at: { not: null },
          original_invoice: { vehicle_id: vehicleId },
        },
      }),
      this.prisma.workshopOrder.count({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: vehicleId,
          pdf_storage_key: { not: null },
          pdf_generated_at: { not: null },
        },
      }),
      this.prisma.vehicleSale.count({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: vehicleId,
          kaufvertrag_archive_key: { not: null },
          kaufvertrag_generated_at: { not: null },
        },
      }),
    ]);
    return invoices + creditNotes + workshopOrders + sales;
  }

  private async loadWarrantyClaimsSection(
    tenantId: string,
    siteId: string,
    vehicleId: string,
    pageSize: number,
    cursor: McpKeysetCursor | null,
  ): Promise<VehicleContextPaginatedSectionResult> {
    const orderScope = {
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: vehicleId,
    };
    const baseWhere: Prisma.WarrantyClaimWhereInput = {
      tenant_id: tenantId,
      workshop_order: orderScope,
    };
    const cursorWhere = cursor ? { AND: [claimsOlderThan(cursor)] } : {};
    const [total, records] = await Promise.all([
      this.prisma.warrantyClaim.count({ where: baseWhere }),
      this.prisma.warrantyClaim.findMany({
        where: {
          tenant_id: tenantId,
          workshop_order: orderScope,
          ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: {
          id: true,
          workshop_order_id: true,
          type: true,
          status: true,
          claimed_amount_net: true,
          external_reference: true,
          createdAt: true,
        },
      }),
    ]);

    const page = buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.createdAt, record.id),
      mapRow: toMcpWarrantyClaimContextRow,
    });

    return {
      state: 'ok',
      data: page.data,
      meta: {
        total,
        page_size: page.meta.page_size,
        next_cursor: this.wrapSectionCursor(
          'warranty_claims',
          page.meta.next_cursor,
        ),
      },
      truncated: page.truncated,
      incomplete: page.meta.next_cursor !== null,
    };
  }

  private async loadWarrantyPeriodsSection(
    tenantId: string,
    siteId: string,
    vehicleId: string,
    asOf: Date,
    pageSize: number,
    cursor: McpKeysetCursor | null,
  ): Promise<VehicleContextPaginatedSectionResult> {
    const today = viennaIsoDay(asOf);
    const baseWhere: Prisma.VehicleSaleWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: vehicleId,
    };
    const cursorWhere = cursor ? { AND: [salesOlderThan(cursor)] } : {};
    const [total, records] = await Promise.all([
      this.prisma.vehicleSale.count({ where: baseWhere }),
      this.prisma.vehicleSale.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: vehicleId,
          ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: {
          id: true,
          sale_number: true,
          contract_concluded_at: true,
          handed_over_at: true,
          gewaehrleistung_ends_on: true,
          presumption_ends_on: true,
          gewaehrleistung_rule_version: true,
          gewaehrleistung_shortened_negotiated: true,
          buyer_is_consumer: true,
          createdAt: true,
        },
      }),
    ]);

    const page = buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.createdAt, record.id),
      mapRow: (sale) =>
        toMcpWarrantyPeriodRow(sale, toGewaehrleistungReadFields(sale, today)),
    });

    return {
      state: 'ok',
      data: page.data,
      meta: {
        total,
        page_size: page.meta.page_size,
        next_cursor: this.wrapSectionCursor(
          'warranty_periods',
          page.meta.next_cursor,
        ),
      },
      truncated: page.truncated,
      incomplete: page.meta.next_cursor !== null,
    };
  }

  private wrapSectionCursor(
    section: McpVehicleContextPaginatedSection,
    nextCursor: string | null,
  ): string | null {
    if (!nextCursor) {
      return null;
    }
    const keyset = decodeMcpKeysetCursor(nextCursor);
    if (!keyset) {
      return null;
    }
    return encodeMcpVehicleContextCursor({ section, keyset });
  }
}

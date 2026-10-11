import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import {
  PDF_READ_LINK_MAX_TTL_SECONDS,
  PdfStorage,
} from '../common/pdf/pdf-storage.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildMcpKeysetPage, keysetCursorOf } from './mcp-audit-read.mapper.js';
import {
  MCP_DOCUMENT_TYPES,
  mcpDocumentFileName,
  parseMcpDocumentId,
  toMcpDocumentPdf,
  toMcpDocumentRow,
  type McpDocumentCandidate,
  type McpDocumentEntityType,
  type McpDocumentType,
} from './mcp-document-read.mapper.js';
import {
  clampMcpPageSize,
  decodeMcpKeysetCursor,
  type McpKeysetCursor,
} from './mcp-output.util.js';
import type {
  getDocumentPdfInputSchema,
  listDocumentsInputSchema,
} from './mcp-tool-schemas.js';

type ListDocumentsInput = z.infer<typeof listDocumentsInputSchema>;
type GetDocumentPdfInput = z.infer<typeof getDocumentPdfInputSchema>;

type DocumentOwnerFilter = {
  entityType: McpDocumentEntityType;
  entityId: string;
};

type DocumentQuery = {
  tenantId: string;
  siteId: string;
  owner: DocumentOwnerFilter | null;
  cursor: McpKeysetCursor | null;
  take: number;
};

type LocatedDocument = {
  candidate: McpDocumentCandidate;
  bucket: string | null;
  key: string;
};

function decodeCursorOrThrow(cursor: string): McpKeysetCursor {
  const decoded = decodeMcpKeysetCursor(cursor);
  if (!decoded) {
    throw new BadRequestException('cursor is invalid');
  }
  return decoded;
}

/** Newest first by generation time, then by owner record ID, the same order the keyset cursor walks. */
function compareNewestFirst(
  left: McpDocumentCandidate,
  right: McpDocumentCandidate,
): number {
  const byTime = right.createdAt.getTime() - left.createdAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  if (left.recordId === right.recordId) {
    return 0;
  }
  return left.recordId < right.recordId ? 1 : -1;
}

/**
 * Read-only document tools. Every query is scoped by the tenant from the
 * session and by the active site (ADR-0022), like the invoice reads. A document
 * is listed only once its PDF exists, and a link is issued only for an object
 * read from such a row, so a foreign or unknown ID is not found.
 */
@Injectable()
export class McpDocumentReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly siteContext: SiteContextService,
    private readonly tenantContext: TenantContextService,
    private readonly pdfStorage: PdfStorage,
  ) {}

  async listDocuments(input: ListDocumentsInput) {
    const { tenantId, siteId } = await this.scope();
    const pageSize = clampMcpPageSize(input.pageSize);
    const query: DocumentQuery = {
      tenantId,
      siteId,
      owner:
        input.entity_type && input.entity_id
          ? { entityType: input.entity_type, entityId: input.entity_id }
          : null,
      cursor: input.cursor ? decodeCursorOrThrow(input.cursor) : null,
      take: pageSize + 1,
    };

    const types: readonly McpDocumentType[] = input.type
      ? [input.type]
      : MCP_DOCUMENT_TYPES;
    // Each source returns its own newest pageSize + 1 rows. The merged top
    // pageSize + 1 is therefore exact, and the page below keeps its cursor.
    const batches = await Promise.all(
      types.map((type) => this.candidatesOf(type, query)),
    );
    const newest = batches
      .flat()
      .sort(compareNewestFirst)
      .slice(0, pageSize + 1);

    return buildMcpKeysetPage({
      records: newest,
      pageSize,
      cursorOf: (candidate) =>
        keysetCursorOf(candidate.createdAt, candidate.recordId),
      mapRow: toMcpDocumentRow,
    });
  }

  async getDocumentPdf(input: GetDocumentPdfInput) {
    const parsed = parseMcpDocumentId(input.id);
    if (!parsed) {
      throw new BadRequestException('id must be <type>:<uuid>');
    }
    const { tenantId, siteId } = await this.scope();
    const located = await this.locate(parsed, input.id, tenantId, siteId);

    const link = await this.pdfStorage.createSignedReadUrl({
      bucket: located.bucket,
      key: located.key,
      filename: located.candidate.name,
      ttlSeconds: PDF_READ_LINK_MAX_TTL_SECONDS,
    });
    return toMcpDocumentPdf(located.candidate, link);
  }

  private async scope(): Promise<{ tenantId: string; siteId: string }> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }

  private candidatesOf(
    type: McpDocumentType,
    query: DocumentQuery,
  ): Promise<McpDocumentCandidate[]> {
    switch (type) {
      case 'invoice':
        return this.invoiceCandidates(query);
      case 'credit_note':
        return this.creditNoteCandidates(query);
      case 'workshop_order':
        return this.workshopOrderCandidates(query);
      case 'vehicle_sale_contract':
        return this.vehicleSaleCandidates(query);
    }
  }

  /** Invoices hold their PDF in the immutable archive or in the cached render. */
  private async invoiceCandidates(
    query: DocumentQuery,
  ): Promise<McpDocumentCandidate[]> {
    const owner = query.owner;
    if (
      owner &&
      !['invoice', 'customer', 'vehicle'].includes(owner.entityType)
    ) {
      return [];
    }
    const clauses: Prisma.InvoiceWhereInput[] = [
      {
        OR: [
          { pdf_archive_key: { not: null } },
          { pdf_storage_key: { not: null } },
        ],
      },
    ];
    if (owner) {
      clauses.push(
        owner.entityType === 'invoice'
          ? { id: owner.entityId }
          : owner.entityType === 'customer'
            ? { customer_id: owner.entityId }
            : { vehicle_id: owner.entityId },
      );
    }
    if (query.cursor) {
      const at = new Date(query.cursor.at);
      clauses.push({
        OR: [
          { pdf_generated_at: { lt: at } },
          { pdf_generated_at: at, id: { lt: query.cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.invoice.findMany({
      where: {
        tenant_id: query.tenantId,
        site_id: query.siteId,
        pdf_generated_at: { not: null },
        AND: clauses,
      },
      orderBy: [{ pdf_generated_at: 'desc' }, { id: 'desc' }],
      take: query.take,
      select: { id: true, invoice_number: true, pdf_generated_at: true },
    });
    return rows.flatMap((row) =>
      row.pdf_generated_at
        ? [
            {
              type: 'invoice' as const,
              recordId: row.id,
              createdAt: row.pdf_generated_at,
              name: mcpDocumentFileName('invoice', row.invoice_number, row.id),
            },
          ]
        : [],
    );
  }

  private async creditNoteCandidates(
    query: DocumentQuery,
  ): Promise<McpDocumentCandidate[]> {
    const owner = query.owner;
    if (
      owner &&
      !['credit_note', 'customer', 'vehicle'].includes(owner.entityType)
    ) {
      return [];
    }
    const clauses: Prisma.CreditNoteWhereInput[] = [
      { pdf_storage_key: { not: null } },
    ];
    if (owner) {
      clauses.push(
        owner.entityType === 'credit_note'
          ? { id: owner.entityId }
          : owner.entityType === 'customer'
            ? { original_invoice: { customer_id: owner.entityId } }
            : { original_invoice: { vehicle_id: owner.entityId } },
      );
    }
    if (query.cursor) {
      const at = new Date(query.cursor.at);
      clauses.push({
        OR: [
          { pdf_generated_at: { lt: at } },
          { pdf_generated_at: at, id: { lt: query.cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.creditNote.findMany({
      where: {
        tenant_id: query.tenantId,
        site_id: query.siteId,
        pdf_generated_at: { not: null },
        AND: clauses,
      },
      orderBy: [{ pdf_generated_at: 'desc' }, { id: 'desc' }],
      take: query.take,
      select: { id: true, credit_number: true, pdf_generated_at: true },
    });
    return rows.flatMap((row) =>
      row.pdf_generated_at
        ? [
            {
              type: 'credit_note' as const,
              recordId: row.id,
              createdAt: row.pdf_generated_at,
              name: mcpDocumentFileName(
                'credit_note',
                row.credit_number,
                row.id,
              ),
            },
          ]
        : [],
    );
  }

  private async workshopOrderCandidates(
    query: DocumentQuery,
  ): Promise<McpDocumentCandidate[]> {
    const owner = query.owner;
    if (
      owner &&
      !['workshop_order', 'customer', 'vehicle'].includes(owner.entityType)
    ) {
      return [];
    }
    const clauses: Prisma.WorkshopOrderWhereInput[] = [
      { pdf_storage_key: { not: null } },
    ];
    if (owner) {
      clauses.push(
        owner.entityType === 'workshop_order'
          ? { id: owner.entityId }
          : owner.entityType === 'customer'
            ? { customer_id: owner.entityId }
            : { vehicle_id: owner.entityId },
      );
    }
    if (query.cursor) {
      const at = new Date(query.cursor.at);
      clauses.push({
        OR: [
          { pdf_generated_at: { lt: at } },
          { pdf_generated_at: at, id: { lt: query.cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.workshopOrder.findMany({
      where: {
        tenant_id: query.tenantId,
        site_id: query.siteId,
        pdf_generated_at: { not: null },
        AND: clauses,
      },
      orderBy: [{ pdf_generated_at: 'desc' }, { id: 'desc' }],
      take: query.take,
      select: { id: true, order_number: true, pdf_generated_at: true },
    });
    return rows.flatMap((row) =>
      row.pdf_generated_at
        ? [
            {
              type: 'workshop_order' as const,
              recordId: row.id,
              createdAt: row.pdf_generated_at,
              name: mcpDocumentFileName(
                'workshop_order',
                row.order_number,
                row.id,
              ),
            },
          ]
        : [],
    );
  }

  private async vehicleSaleCandidates(
    query: DocumentQuery,
  ): Promise<McpDocumentCandidate[]> {
    const owner = query.owner;
    if (
      owner &&
      !['vehicle_sale', 'customer', 'vehicle'].includes(owner.entityType)
    ) {
      return [];
    }
    const clauses: Prisma.VehicleSaleWhereInput[] = [
      { kaufvertrag_archive_key: { not: null } },
    ];
    if (owner) {
      clauses.push(
        owner.entityType === 'vehicle_sale'
          ? { id: owner.entityId }
          : owner.entityType === 'customer'
            ? { customer_id: owner.entityId }
            : { vehicle_id: owner.entityId },
      );
    }
    if (query.cursor) {
      const at = new Date(query.cursor.at);
      clauses.push({
        OR: [
          { kaufvertrag_generated_at: { lt: at } },
          { kaufvertrag_generated_at: at, id: { lt: query.cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.vehicleSale.findMany({
      where: {
        tenant_id: query.tenantId,
        site_id: query.siteId,
        kaufvertrag_generated_at: { not: null },
        AND: clauses,
      },
      orderBy: [{ kaufvertrag_generated_at: 'desc' }, { id: 'desc' }],
      take: query.take,
      select: { id: true, sale_number: true, kaufvertrag_generated_at: true },
    });
    return rows.flatMap((row) =>
      row.kaufvertrag_generated_at
        ? [
            {
              type: 'vehicle_sale_contract' as const,
              recordId: row.id,
              createdAt: row.kaufvertrag_generated_at,
              name: mcpDocumentFileName(
                'vehicle_sale_contract',
                row.sale_number,
                row.id,
              ),
            },
          ]
        : [],
    );
  }

  /** Resolves one document ID to its stored object, or fails when the PDF does not exist in scope. */
  private async locate(
    parsed: { type: McpDocumentType; recordId: string },
    documentId: string,
    tenantId: string,
    siteId: string,
  ): Promise<LocatedDocument> {
    const where = { id: parsed.recordId, tenant_id: tenantId, site_id: siteId };
    const notFound = new NotFoundException(
      `Document with ID ${documentId} not found`,
    );
    const notGenerated = new NotFoundException(
      `PDF for document ${documentId} is not generated yet`,
    );

    switch (parsed.type) {
      case 'invoice': {
        const row = await this.prisma.invoice.findFirst({
          where,
          select: {
            id: true,
            invoice_number: true,
            pdf_generated_at: true,
            pdf_archive_bucket: true,
            pdf_archive_key: true,
            pdf_storage_bucket: true,
            pdf_storage_key: true,
          },
        });
        if (!row || !row.pdf_generated_at) {
          throw notFound;
        }
        // The immutable archive is preferred: it is the object the customer received.
        const object = row.pdf_archive_key
          ? { bucket: row.pdf_archive_bucket, key: row.pdf_archive_key }
          : row.pdf_storage_key
            ? { bucket: row.pdf_storage_bucket, key: row.pdf_storage_key }
            : null;
        if (!object) {
          throw notGenerated;
        }
        return {
          candidate: {
            type: 'invoice',
            recordId: row.id,
            createdAt: row.pdf_generated_at,
            name: mcpDocumentFileName('invoice', row.invoice_number, row.id),
          },
          ...object,
        };
      }
      case 'credit_note': {
        const row = await this.prisma.creditNote.findFirst({
          where,
          select: {
            id: true,
            credit_number: true,
            pdf_generated_at: true,
            pdf_storage_bucket: true,
            pdf_storage_key: true,
          },
        });
        if (!row || !row.pdf_generated_at) {
          throw notFound;
        }
        if (!row.pdf_storage_key) {
          throw notGenerated;
        }
        return {
          candidate: {
            type: 'credit_note',
            recordId: row.id,
            createdAt: row.pdf_generated_at,
            name: mcpDocumentFileName('credit_note', row.credit_number, row.id),
          },
          bucket: row.pdf_storage_bucket,
          key: row.pdf_storage_key,
        };
      }
      case 'workshop_order': {
        const row = await this.prisma.workshopOrder.findFirst({
          where,
          select: {
            id: true,
            order_number: true,
            pdf_generated_at: true,
            pdf_storage_bucket: true,
            pdf_storage_key: true,
          },
        });
        if (!row || !row.pdf_generated_at) {
          throw notFound;
        }
        if (!row.pdf_storage_key) {
          throw notGenerated;
        }
        return {
          candidate: {
            type: 'workshop_order',
            recordId: row.id,
            createdAt: row.pdf_generated_at,
            name: mcpDocumentFileName(
              'workshop_order',
              row.order_number,
              row.id,
            ),
          },
          bucket: row.pdf_storage_bucket,
          key: row.pdf_storage_key,
        };
      }
      case 'vehicle_sale_contract': {
        const row = await this.prisma.vehicleSale.findFirst({
          where,
          select: {
            id: true,
            sale_number: true,
            kaufvertrag_generated_at: true,
            kaufvertrag_archive_bucket: true,
            kaufvertrag_archive_key: true,
          },
        });
        if (!row || !row.kaufvertrag_generated_at) {
          throw notFound;
        }
        if (!row.kaufvertrag_archive_key) {
          throw notGenerated;
        }
        return {
          candidate: {
            type: 'vehicle_sale_contract',
            recordId: row.id,
            createdAt: row.kaufvertrag_generated_at,
            name: mcpDocumentFileName(
              'vehicle_sale_contract',
              row.sale_number,
              row.id,
            ),
          },
          bucket: row.kaufvertrag_archive_bucket,
          key: row.kaufvertrag_archive_key,
        };
      }
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CreditNoteStatus,
  InvoiceStatus,
  Prisma,
  type CreditNote,
  type CreditNoteItem,
  type Invoice,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import { lockFinanceSettingsAndAssertOpen } from '../finance/fiscal-lock.helpers.js';
import { isInvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.validation.js';
import type { InvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import { assertSiteReadAccess } from '../site/site.authorization.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  allocateCreditLineAmounts,
  computeRemainingLineBalances,
  type LineBalance,
  type OriginalLineSnapshot,
  type PriorCreditLine,
} from './credit-note-allocation.js';
import { generateCreditNoteNumber } from './credit-note-number.helpers.js';
import { hashCreditNoteFinalizeRequest } from './credit-note-request-hash.js';
import {
  buildCreditNoteLineSnapshot,
  buildCreditNoteSnapshot,
  extractOriginalLineSnapshots,
  isMarginSchemeSnapshot,
} from './credit-note-snapshot.js';
import type {
  CreateCreditNoteDto,
  CreditNoteListQueryDto,
  FinalizeCreditNoteDto,
  UpdateCreditNoteDto,
  VoidCreditNoteDto,
} from './dto/credit-note.dto.js';

type CreditNoteWithItems = CreditNote & { items: CreditNoteItem[] };

type DraftLineInput = {
  originalItemId: string;
  quantity: Prisma.Decimal;
};

const ELIGIBLE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.FINALIZED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
];

@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async createFromInvoice(invoiceId: string, dto: CreateCreditNoteDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const invoice = await this.loadOriginalInvoice(tenantId, invoiceId);
    await this.assertCreditAccess(tenantId, invoice.site_id!);

    const originalSnapshot = this.requireV2Snapshot(invoice);
    this.assertEligibleOriginal(invoice, originalSnapshot);
    const priorCredits = await this.loadPriorCredits(tenantId, invoice.id);
    const originalLines = extractOriginalLineSnapshots(originalSnapshot);
    const remaining = computeRemainingLineBalances(originalLines, priorCredits);
    const draftLines = this.resolveDraftLines({
      dto,
      originalSnapshot,
      remaining,
      priorCredits,
      originalLines,
      invoiceItemIds: new Set(invoice.items.map((item) => item.id)),
    });

    const creditDate = this.parseCreditDate(dto.date);
    this.assertCreditDateAllowed(creditDate, invoice.date);

    const { totals, itemPayloads } = this.buildDraftItemPayloads({
      draftLines,
      originalSnapshot,
      priorCredits,
      originalLines,
    });

    const creditNote = await this.prisma.creditNote.create({
      data: {
        tenant_id: tenantId,
        original_invoice_id: invoice.id,
        site_id: invoice.site_id!,
        legal_entity_id: invoice.legal_entity_id!,
        status: CreditNoteStatus.DRAFT,
        date: creditDate,
        reason: dto.reason.trim(),
        total_net: totals.net,
        total_tax: totals.tax,
        total_gross: totals.gross,
        items: {
          create: itemPayloads.map((item) => ({
            tenant_id: tenantId,
            original_invoice_item_id: item.originalItemId,
            quantity: item.quantity,
            snapshot: item.snapshot as Prisma.InputJsonValue,
          })),
        },
      },
      include: { items: true },
    });

    return this.serializeCreditNote(creditNote, originalSnapshot, priorCredits);
  }

  async list(query: CreditNoteListQueryDto = {}) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();

    const where: Prisma.CreditNoteWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
      ...(search
        ? {
            OR: [
              { credit_number: { contains: search, mode: 'insensitive' } },
              { reason: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.creditNote.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.creditNote.count({ where }),
    ]);

    const data = await Promise.all(
      rows.map(async (row) => {
        const invoice = await this.prisma.invoice.findFirst({
          where: { id: row.original_invoice_id, tenant_id: tenantId },
        });
        const snapshot = invoice ? this.tryV2Snapshot(invoice) : null;
        const priorCredits = await this.loadPriorCredits(
          tenantId,
          row.original_invoice_id,
        );
        return this.serializeCreditNote(row, snapshot, priorCredits);
      }),
    );

    return {
      data,
      meta: {
        total,
        page,
        pageSize: limit,
        pageCount: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const creditNote = await this.loadCreditNote(tenantId, id);
    await this.assertCreditAccess(tenantId, creditNote.site_id);

    const invoice = await this.loadOriginalInvoice(
      tenantId,
      creditNote.original_invoice_id,
    );
    const snapshot = this.tryV2Snapshot(invoice);
    const priorCredits = await this.loadPriorCredits(
      tenantId,
      creditNote.original_invoice_id,
    );

    return this.serializeCreditNote(creditNote, snapshot, priorCredits);
  }

  async updateDraft(id: string, dto: UpdateCreditNoteDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const creditNote = await this.loadCreditNote(tenantId, id);
    await this.assertCreditAccess(tenantId, creditNote.site_id);

    if (creditNote.status !== CreditNoteStatus.DRAFT) {
      throw new ConflictException('Only draft credit notes can be updated.');
    }
    if (creditNote.version !== dto.expectedVersion) {
      throw new ConflictException('Credit note version is stale.');
    }

    const invoice = await this.loadOriginalInvoice(
      tenantId,
      creditNote.original_invoice_id,
    );
    const originalSnapshot = this.requireV2Snapshot(invoice);
    const priorCredits = await this.loadPriorCredits(tenantId, invoice.id);
    const originalLines = extractOriginalLineSnapshots(originalSnapshot);
    const remaining = computeRemainingLineBalances(originalLines, priorCredits);

    const nextDate = dto.date
      ? this.parseCreditDate(dto.date)
      : creditNote.date;
    this.assertCreditDateAllowed(nextDate, invoice.date);

    const draftLines = dto.lines
      ? this.resolveExplicitLines({
          lines: dto.lines,
          originalSnapshot,
          remaining,
          priorCredits,
          originalLines,
          invoiceItemIds: new Set(invoice.items.map((item) => item.id)),
        })
      : creditNote.items.map((item) => ({
          originalItemId: item.original_invoice_item_id,
          quantity: item.quantity,
        }));

    const { totals, itemPayloads } = this.buildDraftItemPayloads({
      draftLines,
      originalSnapshot,
      priorCredits,
      originalLines,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.creditNote.updateMany({
        where: {
          id,
          tenant_id: tenantId,
          status: CreditNoteStatus.DRAFT,
          version: dto.expectedVersion,
        },
        data: {
          date: nextDate,
          reason: dto.reason?.trim() ?? creditNote.reason,
          total_net: totals.net,
          total_tax: totals.tax,
          total_gross: totals.gross,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new ConflictException('Credit note version is stale.');
      }

      await tx.creditNoteItem.deleteMany({
        where: { credit_note_id: id, tenant_id: tenantId },
      });
      await tx.creditNoteItem.createMany({
        data: itemPayloads.map((item) => ({
          tenant_id: tenantId,
          credit_note_id: id,
          original_invoice_item_id: item.originalItemId,
          quantity: item.quantity,
          snapshot: item.snapshot as Prisma.InputJsonValue,
        })),
      });

      return tx.creditNote.findFirstOrThrow({
        where: { id, tenant_id: tenantId },
        include: { items: true },
      });
    });

    return this.serializeCreditNote(updated, originalSnapshot, priorCredits);
  }

  async finalize(id: string, dto: FinalizeCreditNoteDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const requestHash = hashCreditNoteFinalizeRequest(dto);

    const existingByKey = await this.prisma.creditNote.findFirst({
      where: { tenant_id: tenantId, idempotency_key: dto.idempotencyKey },
      include: { items: true },
    });
    if (existingByKey) {
      if (existingByKey.id !== id) {
        throw new ConflictException(
          'This idempotency key was already used with a different credit note.',
        );
      }
      if (existingByKey.status === CreditNoteStatus.FINALIZED) {
        if (existingByKey.request_hash !== requestHash) {
          throw new ConflictException(
            'This idempotency key was already used with a different request body.',
          );
        }
        const invoice = await this.loadOriginalInvoice(
          tenantId,
          existingByKey.original_invoice_id,
        );
        const priorCredits = await this.loadPriorCredits(
          tenantId,
          existingByKey.original_invoice_id,
        );
        return this.serializeCreditNote(
          existingByKey,
          this.tryV2Snapshot(invoice),
          priorCredits,
        );
      }
    }

    const creditNote = await this.loadCreditNote(tenantId, id);
    await this.assertCreditAccess(tenantId, creditNote.site_id);

    if (creditNote.status !== CreditNoteStatus.DRAFT) {
      throw new ConflictException('Only draft credit notes can be finalized.');
    }
    if (creditNote.version !== dto.expectedVersion) {
      throw new ConflictException('Credit note version is stale.');
    }

    const finalized = await this.prisma.$transaction(async (tx) => {
      await this.lockOriginalInvoice(
        tx,
        tenantId,
        creditNote.original_invoice_id,
      );

      const invoice = await tx.invoice.findFirstOrThrow({
        where: { id: creditNote.original_invoice_id, tenant_id: tenantId },
      });
      const originalSnapshot = this.requireV2Snapshot(invoice);
      await lockSitesAndAssertActive(tx, tenantId, [creditNote.site_id]);
      await lockFinanceSettingsAndAssertOpen(tx, tenantId, creditNote.date);
      this.assertCreditDateAllowed(creditNote.date, invoice.date);

      const priorCredits = await this.loadPriorCredits(
        tenantId,
        invoice.id,
        tx,
        id,
      );
      const originalLines = extractOriginalLineSnapshots(originalSnapshot);
      const draftLines = creditNote.items.map((item) => ({
        originalItemId: item.original_invoice_item_id,
        quantity: item.quantity,
      }));
      this.validateDraftLinesWithinRemaining({
        draftLines,
        originalSnapshot,
        priorCredits,
        originalLines,
      });

      const { totals, itemPayloads } = this.buildDraftItemPayloads({
        draftLines,
        originalSnapshot,
        priorCredits,
        originalLines,
      });

      const isFullCredit = this.isFullCreditDraft(
        draftLines,
        computeRemainingLineBalances(originalLines, priorCredits),
      );
      const committedAt = new Date();
      const snapshot = buildCreditNoteSnapshot({
        originalSnapshot,
        originalInvoiceId: invoice.id,
        originalInvoiceNumber: invoice.invoice_number ?? '',
        originalInvoiceDate: invoice.date,
        reason: creditNote.reason,
        creditDate: creditNote.date,
        isFullCredit,
        lineSnapshots: itemPayloads.map((item) => item.snapshot),
        committedAt,
      });

      const creditNumber = await generateCreditNoteNumber(
        tx,
        tenantId,
        creditNote.date,
      );

      await guardedStatusUpdate(bindStatusUpdateMany(tx.creditNote), {
        id,
        tenantId,
        from: CreditNoteStatus.DRAFT,
        to: CreditNoteStatus.FINALIZED,
        extraData: {
          credit_number: creditNumber,
          total_net: totals.net,
          total_tax: totals.tax,
          total_gross: totals.gross,
          snapshot: snapshot as Prisma.InputJsonValue,
          idempotency_key: dto.idempotencyKey,
          request_hash: requestHash,
          finalized_at: committedAt,
        },
        conflictMessage:
          'Credit note was already transitioned by another request',
      });

      for (const item of itemPayloads) {
        await tx.creditNoteItem.updateMany({
          where: {
            credit_note_id: id,
            tenant_id: tenantId,
            original_invoice_item_id: item.originalItemId,
          },
          data: { snapshot: item.snapshot as Prisma.InputJsonValue },
        });
      }

      return tx.creditNote.findFirstOrThrow({
        where: { id, tenant_id: tenantId },
        include: { items: true },
      });
    });

    const invoice = await this.loadOriginalInvoice(
      tenantId,
      finalized.original_invoice_id,
    );
    const priorCredits = await this.loadPriorCredits(
      tenantId,
      finalized.original_invoice_id,
    );
    return this.serializeCreditNote(
      finalized,
      this.tryV2Snapshot(invoice),
      priorCredits,
    );
  }

  async void(id: string, dto: VoidCreditNoteDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const creditNote = await this.loadCreditNote(tenantId, id);
    await this.assertCreditAccess(tenantId, creditNote.site_id);

    if (creditNote.status !== CreditNoteStatus.DRAFT) {
      throw new ConflictException('Only draft credit notes can be voided.');
    }
    if (creditNote.version !== dto.expectedVersion) {
      throw new ConflictException('Credit note version is stale.');
    }

    const result = await this.prisma.creditNote.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        status: CreditNoteStatus.DRAFT,
        version: dto.expectedVersion,
      },
      data: {
        status: CreditNoteStatus.VOID,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException('Credit note version is stale.');
    }

    const invoice = await this.loadOriginalInvoice(
      tenantId,
      creditNote.original_invoice_id,
    );
    const priorCredits = await this.loadPriorCredits(
      tenantId,
      creditNote.original_invoice_id,
    );
    const updated = await this.loadCreditNote(tenantId, id);
    return this.serializeCreditNote(
      updated,
      this.tryV2Snapshot(invoice),
      priorCredits,
    );
  }

  private async loadOriginalInvoice(
    tenantId: string,
    invoiceId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, tenant_id: tenantId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  private async loadCreditNote(tenantId: string, id: string) {
    const creditNote = await this.prisma.creditNote.findFirst({
      where: { id, tenant_id: tenantId },
      include: { items: true },
    });
    if (!creditNote) {
      throw new NotFoundException('Credit note not found');
    }
    return creditNote;
  }

  private async assertCreditAccess(tenantId: string, siteId: string) {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
    await assertSiteReadAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
      siteId,
    );
  }

  private requireV2Snapshot(invoice: Invoice): InvoiceSnapshotV2 {
    const snapshot = this.tryV2Snapshot(invoice);
    if (!snapshot) {
      throw new UnprocessableEntityException({
        code: 'LEGACY_DOCUMENT_UNSUPPORTED',
        message: 'Credit notes require a version-2 invoice snapshot.',
      });
    }
    return snapshot;
  }

  private tryV2Snapshot(invoice: Invoice): InvoiceSnapshotV2 | null {
    if (!isInvoiceSnapshotV2(invoice.snapshot)) {
      return null;
    }
    return invoice.snapshot;
  }

  private assertEligibleOriginal(
    invoice: Invoice,
    originalSnapshot: InvoiceSnapshotV2,
  ) {
    if (!ELIGIBLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new UnprocessableEntityException({
        code: 'LEGACY_DOCUMENT_UNSUPPORTED',
        message: 'Only committed invoices can be credited.',
      });
    }
    if (
      !invoice.site_id ||
      !invoice.legal_entity_id ||
      !invoice.invoice_number
    ) {
      throw new UnprocessableEntityException({
        code: 'LEGACY_DOCUMENT_UNSUPPORTED',
        message: 'Invoice ownership or numbering evidence is incomplete.',
      });
    }
    void originalSnapshot;
  }

  private parseCreditDate(value: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid credit date.');
    }
    return parsed;
  }

  private assertCreditDateAllowed(creditDate: Date, originalInvoiceDate: Date) {
    const originalDate = new Date(
      originalInvoiceDate.toISOString().slice(0, 10) + 'T00:00:00.000Z',
    );
    if (creditDate < originalDate) {
      throw new UnprocessableEntityException({
        code: 'FISCAL_PERIOD_LOCKED',
        message:
          'Credit date cannot be earlier than the original invoice date.',
      });
    }
  }

  private resolveDraftLines(input: {
    dto: CreateCreditNoteDto;
    originalSnapshot: InvoiceSnapshotV2;
    remaining: Map<string, LineBalance>;
    priorCredits: PriorCreditLine[];
    originalLines: OriginalLineSnapshot[];
    invoiceItemIds: Set<string>;
  }): DraftLineInput[] {
    if (input.dto.mode === 'FULL') {
      if (isMarginSchemeSnapshot(input.originalSnapshot)) {
        return input.originalLines
          .map((line) => ({
            originalItemId: line.id,
            quantity:
              input.remaining.get(line.id)?.quantity ?? new Prisma.Decimal(0),
          }))
          .filter((line) => line.quantity.gt(0));
      }
      return input.originalLines
        .map((line) => ({
          originalItemId: line.id,
          quantity:
            input.remaining.get(line.id)?.quantity ?? new Prisma.Decimal(0),
        }))
        .filter((line) => line.quantity.gt(0));
    }

    if (isMarginSchemeSnapshot(input.originalSnapshot)) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_TAX_PROFILE',
        message: 'Margin-scheme invoices only support full-document credits.',
      });
    }

    if (!input.dto.lines?.length) {
      throw new BadRequestException(
        'Partial credits require at least one line.',
      );
    }

    return this.resolveExplicitLines({
      lines: input.dto.lines,
      originalSnapshot: input.originalSnapshot,
      remaining: input.remaining,
      priorCredits: input.priorCredits,
      originalLines: input.originalLines,
      invoiceItemIds: input.invoiceItemIds,
    });
  }

  private resolveExplicitLines(input: {
    lines: Array<{ originalItemId: string; quantity: string }>;
    originalSnapshot: InvoiceSnapshotV2;
    remaining: Map<string, LineBalance>;
    priorCredits: PriorCreditLine[];
    originalLines: OriginalLineSnapshot[];
    invoiceItemIds: Set<string>;
  }): DraftLineInput[] {
    const originalLineIds = new Set(input.originalLines.map((line) => line.id));
    const seen = new Set<string>();

    return input.lines.map((line) => {
      if (
        !originalLineIds.has(line.originalItemId) ||
        !input.invoiceItemIds.has(line.originalItemId)
      ) {
        throw new BadRequestException(
          'Credit line does not belong to the original invoice.',
        );
      }
      if (seen.has(line.originalItemId)) {
        throw new BadRequestException(
          'Duplicate credit lines are not allowed.',
        );
      }
      seen.add(line.originalItemId);

      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.lte(0)) {
        throw new BadRequestException(
          'Credit quantity must be greater than zero.',
        );
      }

      const balance = input.remaining.get(line.originalItemId);
      if (!balance || quantity.gt(balance.quantity)) {
        throw new ConflictException({
          code: 'CREDIT_LIMIT_EXCEEDED',
          message: 'Credit quantity exceeds the remaining balance.',
        });
      }

      return { originalItemId: line.originalItemId, quantity };
    });
  }

  private buildDraftItemPayloads(input: {
    draftLines: DraftLineInput[];
    originalSnapshot: InvoiceSnapshotV2;
    priorCredits: PriorCreditLine[];
    originalLines: OriginalLineSnapshot[];
  }) {
    if (input.draftLines.length === 0) {
      throw new ConflictException({
        code: 'CREDIT_LIMIT_EXCEEDED',
        message: 'No remaining creditable quantity is available.',
      });
    }

    const originalById = new Map(
      input.originalLines.map((line) => [line.id, line]),
    );
    const snapshotById = new Map(
      input.originalSnapshot.items.map((item) => [item.id, item]),
    );

    let totalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);
    let totalGross = new Prisma.Decimal(0);

    const itemPayloads = input.draftLines.map((line) => {
      const original = originalById.get(line.originalItemId);
      const snapshotItem = snapshotById.get(line.originalItemId);
      if (!original || !snapshotItem) {
        throw new BadRequestException('Unknown original invoice line.');
      }

      const amounts = allocateCreditLineAmounts({
        original,
        creditQuantity: line.quantity,
        priorCredits: input.priorCredits,
      });
      const lineSnapshot = buildCreditNoteLineSnapshot({
        originalItemId: line.originalItemId,
        originalSnapshotItem: snapshotItem,
        quantity: amounts.quantity,
        net: amounts.net,
        tax: amounts.tax,
        gross: amounts.gross,
      });

      totalNet = totalNet.add(amounts.net);
      totalTax = totalTax.add(amounts.tax);
      totalGross = totalGross.add(amounts.gross);

      return {
        originalItemId: line.originalItemId,
        quantity: amounts.quantity,
        snapshot: lineSnapshot,
      };
    });

    return {
      totals: { net: totalNet, tax: totalTax, gross: totalGross },
      itemPayloads,
    };
  }

  private validateDraftLinesWithinRemaining(input: {
    draftLines: DraftLineInput[];
    originalSnapshot: InvoiceSnapshotV2;
    priorCredits: PriorCreditLine[];
    originalLines: OriginalLineSnapshot[];
  }) {
    const remaining = computeRemainingLineBalances(
      input.originalLines,
      input.priorCredits,
    );
    for (const line of input.draftLines) {
      const balance = remaining.get(line.originalItemId);
      if (!balance || line.quantity.gt(balance.quantity)) {
        throw new ConflictException({
          code: 'CREDIT_LIMIT_EXCEEDED',
          message: 'Credit quantity exceeds the remaining balance.',
        });
      }
    }
    if (isMarginSchemeSnapshot(input.originalSnapshot)) {
      const isFull = this.isFullCreditDraft(input.draftLines, remaining);
      if (!isFull) {
        throw new UnprocessableEntityException({
          code: 'UNSUPPORTED_TAX_PROFILE',
          message: 'Margin-scheme invoices only support full-document credits.',
        });
      }
    }
  }

  private isFullCreditDraft(
    draftLines: DraftLineInput[],
    remaining: Map<string, { quantity: Prisma.Decimal }>,
  ): boolean {
    for (const [lineId, balance] of remaining.entries()) {
      if (balance.quantity.lte(0)) {
        continue;
      }
      const credited = draftLines.find(
        (line) => line.originalItemId === lineId,
      );
      if (!credited || !credited.quantity.eq(balance.quantity)) {
        return false;
      }
    }
    return true;
  }

  private async loadPriorCredits(
    tenantId: string,
    invoiceId: string,
    tx: Prisma.TransactionClient = this.prisma,
    excludeCreditNoteId?: string,
  ): Promise<PriorCreditLine[]> {
    const credits = await tx.creditNote.findMany({
      where: {
        tenant_id: tenantId,
        original_invoice_id: invoiceId,
        status: CreditNoteStatus.FINALIZED,
        ...(excludeCreditNoteId ? { id: { not: excludeCreditNoteId } } : {}),
      },
      include: { items: true },
    });

    const lines: PriorCreditLine[] = [];
    for (const credit of credits) {
      for (const item of credit.items) {
        const snapshot = item.snapshot as {
          net?: string;
          tax?: string;
          gross?: string;
        } | null;
        lines.push({
          originalItemId: item.original_invoice_item_id,
          quantity: item.quantity,
          net: new Prisma.Decimal(snapshot?.net ?? 0),
          tax: new Prisma.Decimal(snapshot?.tax ?? 0),
          gross: new Prisma.Decimal(snapshot?.gross ?? 0),
        });
      }
    }
    return lines;
  }

  private async lockOriginalInvoice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ) {
    // eslint-disable-next-line no-restricted-syntax -- ADR-0023 credit commands serialize on the original invoice.
    await tx.$queryRaw`
      SELECT id
      FROM invoices
      WHERE tenant_id = ${tenantId}
        AND id = ${invoiceId}
      FOR UPDATE
    `;
  }

  private serializeCreditNote(
    creditNote: CreditNoteWithItems,
    originalSnapshot: InvoiceSnapshotV2 | null,
    priorCredits: PriorCreditLine[],
  ) {
    const remainingLines =
      originalSnapshot === null
        ? []
        : [
            ...computeRemainingLineBalances(
              extractOriginalLineSnapshots(originalSnapshot),
              priorCredits,
            ).entries(),
          ].map(([originalItemId, balance]) => ({
            originalItemId,
            remainingQuantity: balance.quantity.toFixed(3),
            remainingNet: balance.net.toFixed(2),
            remainingTax: balance.tax.toFixed(2),
            remainingGross: balance.gross.toFixed(2),
          }));

    return {
      id: creditNote.id,
      originalInvoiceId: creditNote.original_invoice_id,
      status: creditNote.status,
      creditNumber: creditNote.credit_number,
      date: creditNote.date.toISOString().slice(0, 10),
      reason: creditNote.reason,
      version: creditNote.version,
      totalNet: creditNote.total_net.toFixed(2),
      totalTax: creditNote.total_tax.toFixed(2),
      totalGross: creditNote.total_gross.toFixed(2),
      items: creditNote.items.map((item) => ({
        id: item.id,
        originalInvoiceItemId: item.original_invoice_item_id,
        quantity: item.quantity.toFixed(3),
        snapshot: (item.snapshot as Record<string, unknown> | null) ?? null,
      })),
      remainingLines,
    };
  }
}

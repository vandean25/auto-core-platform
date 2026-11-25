import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditLogAction,
  CustomerNoteRetentionClass,
  TenantMemberRole,
} from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import {
  computeCustomerNoteRetainUntil,
  hashCustomerNoteBody,
  resolveLastCustomerActivityAt,
} from './customer-note-retention.helpers.js';
import type {
  CreateCustomerNoteDto,
  CustomerNoteListResponseDto,
  CustomerNoteResponseDto,
  UpdateCustomerNoteDto,
} from './dto/customer-note.dto.js';

const NOTE_SELECT = {
  id: true,
  customer_id: true,
  body: true,
  pinned: true,
  author_member_id: true,
  author_role: true,
  retention_class: true,
  retain_until: true,
  legal_hold: true,
  created_at: true,
  updated_at: true,
} as const;

const NOTE_MUTATION_SELECT = {
  ...NOTE_SELECT,
  erasure_restricted: true,
} as const;

function toResponseDto(row: {
  id: string;
  customer_id: string;
  body: string | null;
  pinned: boolean;
  author_member_id: string | null;
  author_role: TenantMemberRole | null;
  retention_class: CustomerNoteRetentionClass;
  retain_until: Date;
  legal_hold: boolean;
  created_at: Date;
  updated_at: Date;
}): CustomerNoteResponseDto {
  return {
    id: row.id,
    customer_id: row.customer_id,
    body: row.body ?? '',
    pinned: row.pinned,
    author_member_id: row.author_member_id,
    author_role: row.author_role,
    retention_class: row.retention_class,
    retain_until: row.retain_until,
    legal_hold: row.legal_hold,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly siteContext: SiteContextService,
  ) {}

  async list(customerId: string): Promise<CustomerNoteListResponseDto> {
    this.assertNoteAccess();
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertCustomerExists(tenantId, customerId);

    const rows = await this.prisma.customerNote.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        deleted_at: null,
        erasure_restricted: false,
        body: { not: null },
      },
      orderBy: [{ pinned: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      select: NOTE_SELECT,
    });

    return { data: rows.map(toResponseDto) };
  }

  async create(
    customerId: string,
    dto: CreateCustomerNoteDto,
  ): Promise<CustomerNoteResponseDto> {
    this.assertNoteAccess();
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertCustomerExists(tenantId, customerId);

    const trimmedBody = dto.body.trim();
    if (!trimmedBody) {
      throw new BadRequestException('Customer note body cannot be empty.');
    }

    const authUser = this.tenantContext.getAuthenticatedUser();
    const actorUserId = authUser?.userId ?? null;
    const member = actorUserId
      ? await this.prisma.tenantMember.findFirst({
          where: { tenant_id: tenantId, user_id: actorUserId, is_active: true },
          select: { id: true, role: true },
        })
      : null;

    const now = new Date();
    const retention = await this.resolveCreateRetention(
      tenantId,
      customerId,
      dto.invoice_id,
      now,
    );
    const bodyHash = hashCustomerNoteBody(trimmedBody);
    const authorRole =
      member?.role ??
      (authUser && 'role' in authUser
        ? (authUser.role as TenantMemberRole)
        : null);

    const created = await this.prisma.$transaction(async (tx) => {
      const note = await tx.customerNote.create({
        data: {
          tenant_id: tenantId,
          customer_id: customerId,
          body: trimmedBody,
          pinned: dto.pinned ?? false,
          author_member_id: member?.id ?? null,
          author_role: authorRole,
          retention_class: retention.retentionClass,
          retain_until: retention.retainUntil,
          legal_hold: retention.legalHold,
        },
        select: NOTE_SELECT,
      });

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CustomerNote',
          entityId: note.id,
          action: AuditLogAction.CREATE,
          actorUserId,
          source: 'CUSTOMER_NOTE_CREATE',
          after: {
            customer_id: customerId,
            note_id: note.id,
            pinned: note.pinned,
            retention_class: note.retention_class,
            body_sha256: bodyHash,
          },
        },
        tx,
      );

      return note;
    });

    return toResponseDto(created);
  }

  async update(
    customerId: string,
    noteId: string,
    dto: UpdateCustomerNoteDto,
  ): Promise<CustomerNoteResponseDto> {
    this.assertNoteAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const actorUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    const existing = await this.prisma.customerNote.findFirst({
      where: {
        id: noteId,
        tenant_id: tenantId,
        customer_id: customerId,
        deleted_at: null,
      },
      select: NOTE_MUTATION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(`Customer note ${noteId} not found`);
    }
    if (existing.erasure_restricted) {
      throw new ForbiddenException(
        'Customer note is restricted after GDPR erasure.',
      );
    }

    let nextBody = existing.body ?? '';
    if (dto.body !== undefined) {
      const trimmed = dto.body.trim();
      if (!trimmed) {
        throw new BadRequestException('Customer note body cannot be empty.');
      }
      nextBody = trimmed;
    }
    const nextPinned = dto.pinned ?? existing.pinned;
    const now = new Date();
    let nextRetainUntil = existing.retain_until;
    if (existing.retention_class === CustomerNoteRetentionClass.OPERATIONAL) {
      const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
      const lastCustomerActivityAt = await resolveLastCustomerActivityAt(
        this.prisma,
        tenantId,
        customerId,
        authorizedSiteIds,
      );
      nextRetainUntil = computeCustomerNoteRetainUntil({
        retentionClass: existing.retention_class,
        now,
        lastCustomerActivityAt,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const note = await tx.customerNote.update({
        where: { id: existing.id },
        data: {
          body: nextBody,
          pinned: nextPinned,
          retain_until: nextRetainUntil,
        },
        select: NOTE_SELECT,
      });

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CustomerNote',
          entityId: note.id,
          action: AuditLogAction.UPDATE,
          actorUserId,
          source: 'CUSTOMER_NOTE_UPDATE',
          before: {
            customer_id: customerId,
            note_id: existing.id,
            pinned: existing.pinned,
            body_sha256: existing.body
              ? hashCustomerNoteBody(existing.body)
              : null,
          },
          after: {
            customer_id: customerId,
            note_id: note.id,
            pinned: note.pinned,
            body_sha256: hashCustomerNoteBody(nextBody),
          },
        },
        tx,
      );

      return note;
    });

    return toResponseDto(updated);
  }

  async setPinned(
    customerId: string,
    noteId: string,
    pinned: boolean,
  ): Promise<CustomerNoteResponseDto> {
    this.assertNoteAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const actorUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    const existing = await this.prisma.customerNote.findFirst({
      where: {
        id: noteId,
        tenant_id: tenantId,
        customer_id: customerId,
        deleted_at: null,
      },
      select: NOTE_MUTATION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(`Customer note ${noteId} not found`);
    }
    if (existing.erasure_restricted) {
      throw new ForbiddenException(
        'Customer note is restricted after GDPR erasure.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const note = await tx.customerNote.update({
        where: { id: existing.id },
        data: { pinned },
        select: NOTE_SELECT,
      });

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CustomerNote',
          entityId: note.id,
          action: AuditLogAction.UPDATE,
          actorUserId,
          source: 'CUSTOMER_NOTE_PIN',
          before: {
            customer_id: customerId,
            note_id: existing.id,
            pinned: existing.pinned,
          },
          after: {
            customer_id: customerId,
            note_id: note.id,
            pinned: note.pinned,
          },
        },
        tx,
      );

      return note;
    });

    return toResponseDto(updated);
  }

  async remove(
    customerId: string,
    noteId: string,
  ): Promise<{ id: string; deleted: boolean }> {
    this.assertNoteAccess();
    const tenantId = await this.tenantContext.getTenantId();
    const actorUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    const existing = await this.prisma.customerNote.findFirst({
      where: {
        id: noteId,
        tenant_id: tenantId,
        customer_id: customerId,
        deleted_at: null,
      },
      select: NOTE_MUTATION_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(`Customer note ${noteId} not found`);
    }
    if (existing.erasure_restricted) {
      throw new ForbiddenException(
        'Customer note is restricted after GDPR erasure.',
      );
    }

    const now = new Date();
    const bodyHash = existing.body ? hashCustomerNoteBody(existing.body) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.customerNote.updateMany({
        where: { id: existing.id, tenant_id: tenantId },
        data: {
          body: null,
          pinned: false,
          deleted_at: now,
        },
      });

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CustomerNote',
          entityId: existing.id,
          action: AuditLogAction.DELETE,
          actorUserId,
          source: 'CUSTOMER_NOTE_DELETE',
          before: {
            customer_id: customerId,
            note_id: existing.id,
            body_sha256: bodyHash,
          },
          after: {
            customer_id: customerId,
            note_id: existing.id,
            deleted: true,
          },
        },
        tx,
      );
    });

    return { id: existing.id, deleted: true };
  }

  private async resolveCreateRetention(
    tenantId: string,
    customerId: string,
    invoiceId: string | undefined,
    now: Date,
  ): Promise<{
    retentionClass: CustomerNoteRetentionClass;
    retainUntil: Date;
    legalHold: boolean;
  }> {
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    if (invoiceId) {
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          tenant_id: tenantId,
          customer_id: customerId,
          site_id: { in: [...authorizedSiteIds] },
          status: { in: ['FINALIZED', 'ISSUED', 'PAID'] },
        },
        select: { id: true, date: true },
      });
      if (!invoice) {
        throw new BadRequestException(
          'Linked invoice not found or not finalized for this customer.',
        );
      }
      return {
        retentionClass: CustomerNoteRetentionClass.CLAIMS_3Y,
        retainUntil: computeCustomerNoteRetainUntil({
          retentionClass: CustomerNoteRetentionClass.CLAIMS_3Y,
          now,
          orderClosedAt: invoice.date,
        }),
        legalHold: true,
      };
    }

    const lastCustomerActivityAt = await resolveLastCustomerActivityAt(
      this.prisma,
      tenantId,
      customerId,
      authorizedSiteIds,
    );
    return {
      retentionClass: CustomerNoteRetentionClass.OPERATIONAL,
      retainUntil: computeCustomerNoteRetainUntil({
        retentionClass: CustomerNoteRetentionClass.OPERATIONAL,
        now,
        lastCustomerActivityAt,
      }),
      legalHold: false,
    };
  }

  private assertNoteAccess(): void {
    const authUser = this.tenantContext.getAuthenticatedUser();
    const role = authUser && 'role' in authUser ? authUser.role : null;
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'SALES') {
      throw new ForbiddenException(
        'Missing permission to access customer notes.',
      );
    }
  }

  private async assertCustomerExists(
    tenantId: string,
    customerId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }
  }
}

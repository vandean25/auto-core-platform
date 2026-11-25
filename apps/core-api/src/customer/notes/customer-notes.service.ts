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
import {
  computeCustomerNoteRetainUntil,
  hashCustomerNoteBody,
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

    const retentionClass =
      dto.retention_class ?? CustomerNoteRetentionClass.OPERATIONAL;
    const now = new Date();
    const retainUntil = computeCustomerNoteRetainUntil({
      retentionClass,
      now,
    });
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
          retention_class: retentionClass,
          retain_until: retainUntil,
          legal_hold: dto.legal_hold ?? false,
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
      select: NOTE_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(`Customer note ${noteId} not found`);
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
    const nextRetainUntil =
      existing.retention_class === CustomerNoteRetentionClass.OPERATIONAL
        ? computeCustomerNoteRetainUntil({
            retentionClass: existing.retention_class,
            now,
          })
        : existing.retain_until;

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
      select: NOTE_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(`Customer note ${noteId} not found`);
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
      select: NOTE_SELECT,
    });
    if (!existing) {
      throw new NotFoundException(`Customer note ${noteId} not found`);
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

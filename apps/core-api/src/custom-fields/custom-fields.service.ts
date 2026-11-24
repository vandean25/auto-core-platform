import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  CustomFieldEntity,
  CustomFieldType,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import {
  computeAuditDiff,
  normalizeAuditValue,
} from '../audit/audit-diff.util.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { assertArt9FieldSafety } from './art9-guard.js';
import {
  CUSTOM_FIELDS_DISABLED_CODE,
  CUSTOM_FIELD_KEY_CONFLICT_CODE,
  CUSTOM_FIELD_LIMIT_EXCEEDED_CODE,
  CUSTOM_FIELD_NOT_FOUND_CODE,
  DEFAULT_CUSTOM_FIELD_RETENTION_CLASS,
  MAX_CUSTOM_FIELDS_PER_ENTITY,
} from './custom-fields.constants.js';
import {
  filterVisibleCustomFieldValues,
  normalizeCustomFieldKey,
  validateAndMergeCustomFieldValues,
  validateSelectOptions,
  type CustomFieldScalar,
} from './custom-fields.validation.js';
import type {
  CreateCustomFieldDefinitionDto,
  ReorderCustomFieldDefinitionsDto,
  UpdateCustomFieldDefinitionDto,
} from './dto/custom-field.dto.js';

function escapeCsvCell(value: string | boolean): string {
  const str = String(value);
  const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async isEnabledForTenant(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { custom_fields_enabled: true },
    });
    return Boolean(tenant?.custom_fields_enabled);
  }

  async listDefinitions(entity?: CustomFieldEntity, includeArchived = false) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.customFieldDefinition.findMany({
      where: {
        tenant_id: tenantId,
        ...(entity ? { entity } : {}),
        ...(includeArchived ? {} : { archived: false }),
      },
      orderBy: [{ sort_order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createDefinition(dto: CreateCustomFieldDefinitionDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const actorUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    const key = normalizeCustomFieldKey(dto.key ?? dto.label);
    assertArt9FieldSafety(dto.label, key, dto.confirmNoArt9);
    const options = validateSelectOptions(dto.type, dto.options);

    const activeCount = await this.prisma.customFieldDefinition.count({
      where: {
        tenant_id: tenantId,
        entity: dto.entity,
        archived: false,
      },
    });
    if (activeCount >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
      throw new UnprocessableEntityException({
        code: CUSTOM_FIELD_LIMIT_EXCEEDED_CODE,
        message: `Maximum of ${MAX_CUSTOM_FIELDS_PER_ENTITY} active custom fields per entity reached.`,
      });
    }

    const maxSort = await this.prisma.customFieldDefinition.aggregate({
      where: { tenant_id: tenantId, entity: dto.entity },
      _max: { sort_order: true },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.customFieldDefinition.create({
          data: {
            tenant_id: tenantId,
            entity: dto.entity,
            key,
            label: dto.label.trim(),
            type: dto.type,
            options: options === null ? Prisma.JsonNull : options,
            purpose: dto.purpose.trim(),
            personal_data: dto.personal_data ?? true,
            retention_class:
              dto.retention_class?.trim() ||
              DEFAULT_CUSTOM_FIELD_RETENTION_CLASS,
            archived: false,
            sort_order: (maxSort._max.sort_order ?? -1) + 1,
          },
        });

        await this.auditService.recordTenantMutation(
          {
            entityType: 'CustomFieldDefinition',
            entityId: created.id,
            action: AuditLogAction.CREATE,
            actorUserId,
            after: created,
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: CUSTOM_FIELD_KEY_CONFLICT_CODE,
          message: `A custom field with key "${key}" already exists for ${dto.entity}.`,
        });
      }
      throw error;
    }
  }

  async updateDefinition(id: string, dto: UpdateCustomFieldDefinitionDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const actorUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    const existing = await this.prisma.customFieldDefinition.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: CUSTOM_FIELD_NOT_FOUND_CODE,
        message: `Custom field definition ${id} not found.`,
      });
    }

    if (dto.label !== undefined) {
      assertArt9FieldSafety(dto.label, existing.key, dto.confirmNoArt9);
    }

    const nextOptions =
      dto.options !== undefined
        ? validateSelectOptions(existing.type, dto.options)
        : existing.type === CustomFieldType.SELECT
          ? undefined
          : Prisma.JsonNull;

    if (dto.archived === false && existing.archived) {
      const activeCount = await this.prisma.customFieldDefinition.count({
        where: {
          tenant_id: tenantId,
          entity: existing.entity,
          archived: false,
        },
      });
      if (activeCount >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
        throw new UnprocessableEntityException({
          code: CUSTOM_FIELD_LIMIT_EXCEEDED_CODE,
          message: `Maximum of ${MAX_CUSTOM_FIELDS_PER_ENTITY} active custom fields per entity reached.`,
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customFieldDefinition.update({
        where: { id: existing.id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
          ...(nextOptions !== undefined
            ? {
                options: nextOptions === null ? Prisma.JsonNull : nextOptions,
              }
            : {}),
          ...(dto.purpose !== undefined ? { purpose: dto.purpose.trim() } : {}),
          ...(dto.personal_data !== undefined
            ? { personal_data: dto.personal_data }
            : {}),
          ...(dto.retention_class !== undefined
            ? {
                retention_class:
                  dto.retention_class.trim() ||
                  DEFAULT_CUSTOM_FIELD_RETENTION_CLASS,
              }
            : {}),
          ...(dto.archived !== undefined ? { archived: dto.archived } : {}),
          ...(dto.sort_order !== undefined
            ? { sort_order: dto.sort_order }
            : {}),
        },
      });

      const normalizedBefore = normalizeAuditValue(existing);
      const normalizedAfter = normalizeAuditValue(updated);
      const diff = computeAuditDiff(normalizedBefore, normalizedAfter);
      await this.auditService.recordTenantMutation(
        {
          entityType: 'CustomFieldDefinition',
          entityId: updated.id,
          action: AuditLogAction.UPDATE,
          actorUserId,
          before: normalizedBefore,
          after: normalizedAfter,
          diff,
        },
        tx,
      );

      return updated;
    });
  }

  async reorderDefinitions(dto: ReorderCustomFieldDefinitionsDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const actorUserId =
      this.tenantContext.getAuthenticatedUser()?.userId ?? null;

    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.orderedIds.map((id, index) =>
          tx.customFieldDefinition.updateMany({
            where: { id, tenant_id: tenantId, entity: dto.entity },
            data: { sort_order: index },
          }),
        ),
      );

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CustomFieldDefinition',
          entityId: dto.entity,
          action: AuditLogAction.UPDATE,
          actorUserId,
          after: { entity: dto.entity, orderedIds: dto.orderedIds },
        },
        tx,
      );
    });

    return this.listDefinitions(dto.entity, true);
  }

  async exportCatalogueCsv(): Promise<string> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ entity: 'asc' }, { sort_order: 'asc' }, { createdAt: 'asc' }],
    });

    const header =
      'entity,key,label,type,purpose,personal_data,retention_class,archived';
    const rows = definitions.map((d) =>
      [
        escapeCsvCell(d.entity),
        escapeCsvCell(d.key),
        escapeCsvCell(d.label),
        escapeCsvCell(d.type),
        escapeCsvCell(d.purpose),
        escapeCsvCell(d.personal_data),
        escapeCsvCell(d.retention_class),
        escapeCsvCell(d.archived),
      ].join(','),
    );
    return [header, ...rows].join('\r\n');
  }

  async prepareEntityCustomFieldsWrite(
    entity: CustomFieldEntity,
    existingValues: unknown,
    incomingValues: Record<string, unknown>,
  ): Promise<Record<string, CustomFieldScalar>> {
    const tenantId = await this.tenantContext.getTenantId();
    const enabled = await this.isEnabledForTenant(tenantId);
    if (!enabled) {
      throw new ForbiddenException({
        code: CUSTOM_FIELDS_DISABLED_CODE,
        message: 'Custom fields are not enabled for this tenant.',
      });
    }

    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: { tenant_id: tenantId, entity },
      select: { key: true, type: true, options: true, archived: true },
    });

    return validateAndMergeCustomFieldValues(
      definitions,
      existingValues,
      incomingValues,
    );
  }

  async loadVisibilityDefs(
    entity: CustomFieldEntity,
  ): Promise<Array<{ key: string }> | null> {
    const tenantId = await this.tenantContext.getTenantId();
    const enabled = await this.isEnabledForTenant(tenantId);
    if (!enabled) {
      return null;
    }

    return this.prisma.customFieldDefinition.findMany({
      where: { tenant_id: tenantId, entity, archived: false },
      select: { key: true },
    });
  }

  projectVisibleCustomFieldsWithDefs(
    rawValues: unknown,
    activeDefs: ReadonlyArray<{ key: string }> | null,
  ): Record<string, CustomFieldScalar> | undefined {
    if (activeDefs === null) {
      return undefined;
    }

    return filterVisibleCustomFieldValues(rawValues, activeDefs);
  }

  async projectVisibleCustomFields(
    entity: CustomFieldEntity,
    rawValues: unknown,
  ): Promise<Record<string, CustomFieldScalar> | undefined> {
    const activeDefs = await this.loadVisibilityDefs(entity);
    return this.projectVisibleCustomFieldsWithDefs(rawValues, activeDefs);
  }
}

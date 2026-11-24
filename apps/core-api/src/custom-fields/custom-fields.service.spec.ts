import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  CustomFieldEntity,
  CustomFieldType,
} from '@prisma/client';
import { MAX_CUSTOM_FIELDS_PER_ENTITY } from './custom-fields.constants.js';
import { CustomFieldsService } from './custom-fields.service.js';

describe('CustomFieldsService', () => {
  const tenantId = 'tenant-1';
  const userId = 'user-admin';

  function makeMocks(role: string = 'ADMIN') {
    const prisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ custom_fields_enabled: true }),
      },
      customFieldDefinition: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _max: { sort_order: null } }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'def-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };

    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId,
        email: 'admin@example.com',
        role,
      }),
    };

    const auditService = {
      recordTenantMutation: jest.fn().mockResolvedValue(undefined),
    };

    const service = new CustomFieldsService(
      prisma as never,
      tenantContext as never,
      auditService as never,
    );
    return { service, prisma, tenantContext, auditService };
  }

  it('rejects non-OWNER/ADMIN roles when creating a definition', async () => {
    const { service } = makeMocks('TECH');
    await expect(
      service.createDefinition({
        entity: CustomFieldEntity.CUSTOMER,
        label: 'Flottennummer',
        type: CustomFieldType.TEXT,
        purpose: 'Flottenabrechnung',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects creating a definition when entity limit (30) is reached', async () => {
    const { service, prisma } = makeMocks('ADMIN');
    prisma.customFieldDefinition.count.mockResolvedValue(
      MAX_CUSTOM_FIELDS_PER_ENTITY,
    );

    await expect(
      service.createDefinition({
        entity: CustomFieldEntity.CUSTOMER,
        label: 'Extra Feld',
        type: CustomFieldType.TEXT,
        purpose: 'Test',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('blocks "Gesundheitszustand" and requires confirmation for warning keywords', async () => {
    const { service } = makeMocks('ADMIN');

    await expect(
      service.createDefinition({
        entity: CustomFieldEntity.CUSTOMER,
        label: 'Gesundheitszustand',
        type: CustomFieldType.TEXT,
        purpose: 'Test',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    await expect(
      service.createDefinition({
        entity: CustomFieldEntity.CUSTOMER,
        label: 'Allergie Hinweis',
        type: CustomFieldType.TEXT,
        purpose: 'Kaffee',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    const created = await service.createDefinition({
      entity: CustomFieldEntity.CUSTOMER,
      label: 'Allergie Hinweis',
      type: CustomFieldType.TEXT,
      purpose: 'Kaffee-Service',
      confirmNoArt9: true,
    });
    expect(created.key).toBe('allergie_hinweis');
  });

  it('records an audit entry when a definition is created or updated', async () => {
    const { service, prisma, auditService } = makeMocks('OWNER');

    const created = await service.createDefinition({
      entity: CustomFieldEntity.CUSTOMER,
      label: 'Flottennummer',
      type: CustomFieldType.TEXT,
      purpose: 'Flottenabrechnung',
    });

    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CustomFieldDefinition',
        entityId: created.id,
        action: AuditLogAction.CREATE,
        actorUserId: userId,
      }),
      prisma,
    );

    const existing = {
      ...created,
      archived: false,
      personal_data: true,
      retention_class: 'PARENT_OBJECT',
      options: null,
      sort_order: 0,
    };
    const updatedRow = {
      ...existing,
      label: 'Flotten-Nr.',
      purpose: 'Neue Flottenabrechnung',
    };
    prisma.customFieldDefinition.findFirst.mockResolvedValueOnce(existing);
    prisma.customFieldDefinition.update.mockResolvedValueOnce(updatedRow);

    await service.updateDefinition(created.id, {
      label: 'Flotten-Nr.',
      purpose: 'Neue Flottenabrechnung',
    });

    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CustomFieldDefinition',
        entityId: created.id,
        action: AuditLogAction.UPDATE,
        actorUserId: userId,
        diff: expect.objectContaining({
          changedFields: expect.arrayContaining(['label', 'purpose']),
          diff: expect.objectContaining({
            label: { before: 'Flottennummer', after: 'Flotten-Nr.' },
            purpose: {
              before: 'Flottenabrechnung',
              after: 'Neue Flottenabrechnung',
            },
          }),
        }),
      }),
      prisma,
    );
  });

  it('exports the field catalogue CSV with purpose and personal_data flag', async () => {
    const { service, prisma } = makeMocks('ADMIN');
    prisma.customFieldDefinition.findMany.mockResolvedValue([
      {
        entity: CustomFieldEntity.CUSTOMER,
        key: 'flottennummer',
        label: 'Flottennummer',
        type: CustomFieldType.TEXT,
        purpose: 'Flottenabrechnung',
        personal_data: true,
        retention_class: 'PARENT_OBJECT',
        archived: false,
      },
    ]);

    const csv = await service.exportCatalogueCsv();
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'entity,key,label,type,purpose,personal_data,retention_class,archived',
    );
    expect(lines[1]).toBe(
      'CUSTOMER,flottennummer,Flottennummer,TEXT,Flottenabrechnung,true,PARENT_OBJECT,false',
    );
  });

  it('loads visibility definitions once and projects multiple rows in memory', async () => {
    const { service, prisma } = makeMocks('ADMIN');
    prisma.customFieldDefinition.findMany.mockResolvedValue([
      { key: 'flottennummer' },
    ]);

    const defs = await service.loadVisibilityDefs(CustomFieldEntity.CUSTOMER);
    expect(prisma.tenant.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.customFieldDefinition.findMany).toHaveBeenCalledTimes(1);

    expect(
      service.projectVisibleCustomFieldsWithDefs(
        { flottennummer: 'FL-1', archived_key: 'OLD' },
        defs,
      ),
    ).toEqual({ flottennummer: 'FL-1' });
    expect(
      service.projectVisibleCustomFieldsWithDefs(
        { flottennummer: 'FL-2' },
        defs,
      ),
    ).toEqual({ flottennummer: 'FL-2' });

    prisma.tenant.findFirst.mockResolvedValueOnce({
      custom_fields_enabled: false,
    });
    const disabledDefs = await service.loadVisibilityDefs(
      CustomFieldEntity.CUSTOMER,
    );
    expect(disabledDefs).toBeNull();
    expect(
      service.projectVisibleCustomFieldsWithDefs(
        { flottennummer: 'FL-1' },
        disabledDefs,
      ),
    ).toBeUndefined();
    expect(prisma.customFieldDefinition.findMany).toHaveBeenCalledTimes(1);
  });
});

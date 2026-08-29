import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { AuditActorType, AuditLogAction } from '@prisma/client';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: {
    auditLog: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let tenantContext: {
    getTenantId: jest.Mock;
  };

  const sampleAuditLog = {
    id: 'audit-1',
    tenant_id: 'tenant-123',
    entity_type: 'Customer',
    entity_id: 'cust-1',
    action: AuditLogAction.UPDATE,
    actor_user_id: 'user-1',
    actor_email: 'admin@example.com',
    actor_role: 'ADMIN',
    actor_type: AuditActorType.USER,
    request_id: 'req-123',
    source: 'API',
    ip_address: '127.0.0.1',
    user_agent: 'Mozilla/5.0',
    before: { name: 'Old Name' },
    after: { name: 'New Name' },
    diff: { name: { before: 'Old Name', after: 'New Name' } },
    changed_fields: ['name'],
    redacted_fields: [],
    occurred_at: new Date('2026-08-14T10:00:00Z'),
  };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([sampleAuditLog]),
        count: jest.fn().mockResolvedValue(1),
      },
    };

    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-123'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should enforce tenant isolation in query where clause', async () => {
    const result = await service.findAll({});

    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-123',
        }),
        orderBy: { occurred_at: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
    expect(prisma.auditLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-123',
        }),
      }),
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('audit-1');
    expect(result.data[0].tenantId).toBe('tenant-123');
    expect(result.data[0].entityType).toBe('Customer');
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('should omit private Vehicle identity state from audit log responses', async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        ...sampleAuditLog,
        entity_type: 'Vehicle',
        before: {
          id: 'vehicle-1',
          vin: 'WVWZZZ1JZXW000001',
          identity_resolution_token: 'token-before',
          identity_resolution_generation: 1,
        },
        after: {
          id: 'vehicle-1',
          vin: 'WVWZZZ1JZXW000002',
          identity_resolution_token: 'token-after',
          identity_resolution_generation: 2,
        },
        diff: {
          vin: {
            before: 'WVWZZZ1JZXW000001',
            after: 'WVWZZZ1JZXW000002',
          },
          identity_resolution_token: {
            before: 'token-before',
            after: 'token-after',
          },
        },
        redacted_fields: [],
      },
    ]);

    const result = await service.findAll({});
    const auditRecord = result.data[0];

    expect(auditRecord.before).toEqual({
      id: 'vehicle-1',
      vin: 'WVWZZZ1JZXW000001',
    });
    expect(auditRecord.after).toEqual({
      id: 'vehicle-1',
      vin: 'WVWZZZ1JZXW000002',
    });
    expect(auditRecord.diff).toEqual({
      vin: {
        before: 'WVWZZZ1JZXW000001',
        after: 'WVWZZZ1JZXW000002',
      },
    });
    expect(auditRecord.redactedFields).toEqual([
      'after.identity_resolution_generation',
      'after.identity_resolution_token',
      'before.identity_resolution_generation',
      'before.identity_resolution_token',
      'diff.identity_resolution_token',
    ]);
  });

  it('should apply filters for entityType, entityId, action, actorUserId, date ranges, and search', async () => {
    await service.findAll({
      page: 2,
      limit: 10,
      entityType: 'SalesOrder',
      entityId: 'so-123',
      action: AuditLogAction.DELETE,
      actorUserId: 'user-2',
      startDate: '2026-08-01T00:00:00Z',
      endDate: '2026-08-14T23:59:59Z',
      search: 'search-term',
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: 'tenant-123',
          entity_type: 'SalesOrder',
          entity_id: 'so-123',
          action: AuditLogAction.DELETE,
          actor_user_id: 'user-2',
          occurred_at: {
            gte: new Date('2026-08-01T00:00:00Z'),
            lte: new Date('2026-08-14T23:59:59Z'),
          },
          OR: [
            { entity_id: { contains: 'search-term', mode: 'insensitive' } },
            { actor_email: { contains: 'search-term', mode: 'insensitive' } },
            { request_id: { contains: 'search-term', mode: 'insensitive' } },
          ],
        },
        skip: 10,
        take: 10,
        orderBy: { occurred_at: 'desc' },
      }),
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditActorType, AuditLogAction } from '@prisma/client';
import { QueryAuditLogsDto } from './dto';

describe('AuditController', () => {
  let controller: AuditController;
  let service: {
    findAll: jest.Mock;
  };

  const sampleResponse = {
    data: [
      {
        id: 'audit-1',
        tenantId: 'tenant-123',
        entityType: 'Customer',
        entityId: 'cust-1',
        action: AuditLogAction.UPDATE,
        actorUserId: 'user-1',
        actorEmail: 'admin@example.com',
        actorRole: 'ADMIN',
        actorType: AuditActorType.USER,
        requestId: 'req-123',
        source: 'API',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        before: { name: 'Old Name' },
        after: { name: 'New Name' },
        diff: { name: { before: 'Old Name', after: 'New Name' } },
        changedFields: ['name'],
        redactedFields: [],
        occurredAt: new Date('2026-08-14T10:00:00Z'),
      },
    ],
    meta: {
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue(sampleResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: service }],
    }).compile();

    controller = module.get<AuditController>(AuditController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return audit logs list from service', async () => {
    const query: QueryAuditLogsDto = { page: 1, limit: 20 };
    const result = await controller.findAll(query);

    expect(service.findAll).toHaveBeenCalledWith(query);
    expect(result).toEqual(sampleResponse);
  });
});

import { AuditActorType, AuditLogAction } from '@prisma/client';
import {
  AuditQueryBuilder,
  mapAuditLogRecordToDto,
  redactAuditResponseValue,
} from './audit-query.builder';

describe('AuditQueryBuilder', () => {
  const tenantId = 'tenant-xyz';

  describe('resolvePagination', () => {
    it('should use default page and limit when not provided', () => {
      const result = AuditQueryBuilder.resolvePagination();
      expect(result).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
        take: 20,
      });
    });

    it('should use default page and limit when zero or negative values are provided', () => {
      const result = AuditQueryBuilder.resolvePagination(0, -5);
      expect(result).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
        take: 20,
      });
    });

    it('should correctly calculate skip and take for custom page and limit', () => {
      const result = AuditQueryBuilder.resolvePagination(3, 15);
      expect(result).toEqual({
        page: 3,
        limit: 15,
        skip: 30,
        take: 15,
      });
    });
  });

  describe('buildWhere / computeWhere', () => {
    it('should always enforce tenant isolation in base where clause', () => {
      const where = AuditQueryBuilder.buildWhere(tenantId, {});
      expect(where).toEqual({
        tenant_id: tenantId,
      });
    });

    it('should match computeWhere with buildWhere', () => {
      const query = { entityType: 'Customer' };
      const where1 = AuditQueryBuilder.buildWhere(tenantId, query);
      const where2 = AuditQueryBuilder.computeWhere(tenantId, query);
      expect(where1).toEqual(where2);
    });

    it('should apply entityType filter', () => {
      const where = AuditQueryBuilder.buildWhere(tenantId, {
        entityType: 'Vehicle',
      });
      expect(where.entity_type).toBe('Vehicle');
    });

    it('should apply entityId filter', () => {
      const where = AuditQueryBuilder.buildWhere(tenantId, {
        entityId: 'vehicle-123',
      });
      expect(where.entity_id).toBe('vehicle-123');
    });

    it('should apply action filter', () => {
      const where = AuditQueryBuilder.buildWhere(tenantId, {
        action: AuditLogAction.CREATE,
      });
      expect(where.action).toBe(AuditLogAction.CREATE);
    });

    it('should apply actorUserId filter', () => {
      const where = AuditQueryBuilder.buildWhere(tenantId, {
        actorUserId: 'user-abc',
      });
      expect(where.actor_user_id).toBe('user-abc');
    });

    it('should apply startDate only', () => {
      const startDate = '2026-08-01T00:00:00Z';
      const where = AuditQueryBuilder.buildWhere(tenantId, { startDate });
      expect(where.occurred_at).toEqual({
        gte: new Date(startDate),
      });
    });

    it('should apply endDate only', () => {
      const endDate = '2026-08-31T23:59:59Z';
      const where = AuditQueryBuilder.buildWhere(tenantId, { endDate });
      expect(where.occurred_at).toEqual({
        lte: new Date(endDate),
      });
    });

    it('should apply both startDate and endDate', () => {
      const startDate = '2026-08-01T00:00:00Z';
      const endDate = '2026-08-31T23:59:59Z';
      const where = AuditQueryBuilder.buildWhere(tenantId, {
        startDate,
        endDate,
      });
      expect(where.occurred_at).toEqual({
        gte: new Date(startDate),
        lte: new Date(endDate),
      });
    });

    it('should apply search term to entity_id, actor_email, and request_id insensitive contains', () => {
      const where = AuditQueryBuilder.buildWhere(tenantId, {
        search: '  term123  ',
      });
      expect(where.OR).toEqual([
        { entity_id: { contains: 'term123', mode: 'insensitive' } },
        { actor_email: { contains: 'term123', mode: 'insensitive' } },
        { request_id: { contains: 'term123', mode: 'insensitive' } },
      ]);
    });

    it('should ignore empty or whitespace-only search term', () => {
      const whereEmpty = AuditQueryBuilder.buildWhere(tenantId, { search: '' });
      expect(whereEmpty.OR).toBeUndefined();

      const whereWhitespace = AuditQueryBuilder.buildWhere(tenantId, {
        search: '    ',
      });
      expect(whereWhitespace.OR).toBeUndefined();
    });

    it('should combine all filters correctly', () => {
      const where = AuditQueryBuilder.buildWhere(tenantId, {
        entityType: 'SalesOrder',
        entityId: 'so-1',
        action: AuditLogAction.UPDATE,
        actorUserId: 'usr-99',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
        search: 'keyword',
      });

      expect(where).toEqual({
        tenant_id: tenantId,
        entity_type: 'SalesOrder',
        entity_id: 'so-1',
        action: AuditLogAction.UPDATE,
        actor_user_id: 'usr-99',
        occurred_at: {
          gte: new Date('2026-01-01T00:00:00Z'),
          lte: new Date('2026-01-31T23:59:59Z'),
        },
        OR: [
          { entity_id: { contains: 'keyword', mode: 'insensitive' } },
          { actor_email: { contains: 'keyword', mode: 'insensitive' } },
          { request_id: { contains: 'keyword', mode: 'insensitive' } },
        ],
      });
    });
  });

  describe('buildDateFilter', () => {
    it('should return undefined when neither startDate nor endDate is provided', () => {
      expect(AuditQueryBuilder.buildDateFilter()).toBeUndefined();
      expect(
        AuditQueryBuilder.buildDateFilter(undefined, undefined),
      ).toBeUndefined();
    });
  });

  describe('buildSearchFilter', () => {
    it('should return undefined when search is undefined or blank', () => {
      expect(AuditQueryBuilder.buildSearchFilter()).toBeUndefined();
      expect(AuditQueryBuilder.buildSearchFilter('  ')).toBeUndefined();
    });
  });

  describe('buildOrderBy', () => {
    it('should return default ordering by occurred_at desc', () => {
      expect(AuditQueryBuilder.buildOrderBy()).toEqual({
        occurred_at: 'desc',
      });
    });
  });

  describe('redactAuditResponseValue', () => {
    it('should handle null and undefined', () => {
      expect(redactAuditResponseValue(null, 'before')).toEqual({
        value: null,
        redactedPaths: [],
      });
      expect(redactAuditResponseValue(undefined, 'after')).toEqual({
        value: null,
        redactedPaths: [],
      });
    });

    it('should redact sensitive keys and prefix paths', () => {
      const input = {
        name: 'John',
        password: 'secret-password',
        identity_resolution_token: 'secret-id-token',
      };
      const result = redactAuditResponseValue(input, 'before');
      expect(result.value).toEqual({
        name: 'John',
        password: '[REDACTED]',
      });
      expect(result.redactedPaths).toEqual([
        'before.identity_resolution_token',
        'before.password',
      ]);
    });
  });

  describe('mapRecordToDto', () => {
    const sampleRecord = {
      id: 'log-1',
      tenant_id: 'tenant-123',
      entity_type: 'Invoice',
      entity_id: 'inv-456',
      action: AuditLogAction.UPDATE,
      actor_user_id: 'user-789',
      actor_email: 'finance@example.com',
      actor_role: 'ACCOUNTANT',
      actor_type: AuditActorType.USER,
      request_id: 'req-abc',
      source: 'WEB',
      ip_address: '192.168.1.1',
      user_agent: 'Chrome',
      before: { total: 100 },
      after: { total: 150 },
      diff: { total: { before: 100, after: 150 } },
      changed_fields: ['total'],
      redacted_fields: ['prior_secret'],
      occurred_at: new Date('2026-09-01T12:00:00Z'),
    };

    it('should format an audit log record into AuditLogResponseDto', () => {
      const dto = AuditQueryBuilder.mapRecordToDto(sampleRecord);
      expect(dto).toEqual({
        id: 'log-1',
        tenantId: 'tenant-123',
        entityType: 'Invoice',
        entityId: 'inv-456',
        action: AuditLogAction.UPDATE,
        actorUserId: 'user-789',
        actorEmail: 'finance@example.com',
        actorRole: 'ACCOUNTANT',
        actorType: AuditActorType.USER,
        requestId: 'req-abc',
        source: 'WEB',
        ipAddress: '192.168.1.1',
        userAgent: 'Chrome',
        before: { total: 100 },
        after: { total: 150 },
        diff: { total: { before: 100, after: 150 } },
        changedFields: ['total'],
        redactedFields: ['prior_secret'],
        occurredAt: new Date('2026-09-01T12:00:00Z'),
      });
    });

    it('should handle non-array changed_fields and redacted_fields', () => {
      const dto = mapAuditLogRecordToDto({
        ...sampleRecord,
        changed_fields: null,
        redacted_fields: null,
      });
      expect(dto.changedFields).toBeNull();
      expect(dto.redactedFields).toEqual([]);
    });
  });

  describe('buildPaginatedResponse', () => {
    it('should build paginated response correctly when records exist', () => {
      const sampleRecord = {
        id: 'log-1',
        tenant_id: 'tenant-123',
        entity_type: 'Invoice',
        entity_id: 'inv-456',
        action: AuditLogAction.CREATE,
        actor_user_id: null,
        actor_email: null,
        actor_role: null,
        actor_type: AuditActorType.SYSTEM,
        request_id: null,
        source: null,
        ip_address: null,
        user_agent: null,
        before: null,
        after: { id: 'inv-456' },
        diff: null,
        changed_fields: null,
        redacted_fields: null,
        occurred_at: new Date('2026-09-01T12:00:00Z'),
      };

      const pagination = {
        page: 2,
        limit: 10,
        skip: 10,
        take: 10,
      };

      const response = AuditQueryBuilder.buildPaginatedResponse(
        [sampleRecord],
        25,
        pagination,
      );

      expect(response.data).toHaveLength(1);
      expect(response.data[0].id).toBe('log-1');
      expect(response.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
    });

    it('should set totalPages to 1 when total is 0', () => {
      const pagination = {
        page: 1,
        limit: 20,
        skip: 0,
        take: 20,
      };

      const response = AuditQueryBuilder.buildPaginatedResponse(
        [],
        0,
        pagination,
      );
      expect(response.data).toEqual([]);
      expect(response.meta).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });
  });
});

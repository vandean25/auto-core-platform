import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditActorType, AuditLogAction } from '@prisma/client';

export class AuditLogResponseDto {
  @ApiProperty({ description: 'Audit log unique identifier' })
  id!: string;

  @ApiProperty({ description: 'Tenant identifier' })
  tenantId!: string;

  @ApiProperty({ description: 'Entity model name (e.g. Customer, SalesOrder)' })
  entityType!: string;

  @ApiProperty({ description: 'Target entity record ID' })
  entityId!: string;

  @ApiProperty({ enum: AuditLogAction, description: 'Mutation action type' })
  action!: AuditLogAction;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'User ID of the actor who performed the mutation',
  })
  actorUserId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Email of the actor who performed the mutation',
  })
  actorEmail?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Role of the actor at mutation time',
  })
  actorRole?: string | null;

  @ApiProperty({
    enum: AuditActorType,
    description: 'Actor classification type',
  })
  actorType!: AuditActorType;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'HTTP request correlation ID',
  })
  requestId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Source channel (e.g. API, JOB)',
  })
  source?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Client IP address',
  })
  ipAddress?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Client User-Agent header',
  })
  userAgent?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Snapshot of entity state before mutation',
  })
  before?: unknown;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Snapshot of entity state after mutation',
  })
  after?: unknown;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Computed diff of changed fields',
  })
  diff?: unknown;

  @ApiPropertyOptional({
    nullable: true,
    type: [String],
    description: 'List of field names that changed',
  })
  changedFields?: string[] | null;

  @ApiPropertyOptional({
    nullable: true,
    type: [String],
    description: 'List of field names that were redacted',
  })
  redactedFields?: string[] | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Timestamp when mutation occurred',
  })
  occurredAt!: Date;
}

export class AuditLogPaginationMetaDto {
  @ApiProperty({
    example: 42,
    description: 'Total number of matching audit records',
  })
  total!: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page!: number;

  @ApiProperty({ example: 20, description: 'Items per page' })
  limit!: number;

  @ApiProperty({ example: 3, description: 'Total number of pages' })
  totalPages!: number;
}

export class AuditLogListResponseDto {
  @ApiProperty({
    type: [AuditLogResponseDto],
    description: 'List of audit log items',
  })
  data!: AuditLogResponseDto[];

  @ApiProperty({
    type: AuditLogPaginationMetaDto,
    description: 'Pagination metadata',
  })
  meta!: AuditLogPaginationMetaDto;
}

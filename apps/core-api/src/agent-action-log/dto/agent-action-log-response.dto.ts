import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgentActionLogActorType } from '@prisma/client';
import {
  AGENT_ACTION_STATUSES,
  AGENT_ACTION_TIERS,
} from '../agent-action-log.types.js';
import { AuditLogResponseDto } from '../../audit/dto/audit-log-response.dto.js';

export class AgentActionLogResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  parentTraceId?: string | null;

  @ApiProperty({ enum: AgentActionLogActorType })
  actorType!: AgentActionLogActorType;

  @ApiPropertyOptional({ nullable: true })
  agentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  onBehalfOfUserId?: string | null;

  /** TenantApiKey id for public API requests (actorType API_KEY). Never the secret. */
  @ApiPropertyOptional({ nullable: true })
  apiKeyId?: string | null;

  @ApiProperty()
  actionType!: string;

  @ApiProperty({ enum: AGENT_ACTION_TIERS })
  tier!: string;

  @ApiProperty({ enum: AGENT_ACTION_STATUSES })
  status!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  inputSummary?: unknown;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  resultSummary?: unknown;

  @ApiPropertyOptional({ nullable: true })
  entityType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  entityId?: string | null;

  @ApiProperty()
  reversible!: boolean;

  @ApiPropertyOptional({ nullable: true })
  revertedByLogId?: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AgentActionLogListResponseDto {
  @ApiProperty({ type: [AgentActionLogResponseDto] })
  data!: AgentActionLogResponseDto[];

  @ApiPropertyOptional({
    type: String,
    description: 'Cursor for the next page when more results exist',
    nullable: true,
  })
  nextCursor?: string | null;
}

export class AgentActionTraceDetailResponseDto {
  @ApiProperty({ type: [AgentActionLogResponseDto] })
  logs!: AgentActionLogResponseDto[];

  @ApiProperty({ type: [AuditLogResponseDto] })
  auditEntries!: AuditLogResponseDto[];
}

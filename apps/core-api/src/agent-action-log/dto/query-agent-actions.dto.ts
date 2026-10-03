import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  AGENT_ACTION_STATUSES,
  AGENT_ACTION_TIERS,
} from '../agent-action-log.types.js';

export class QueryAgentActionsDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Maximum number of rows to return',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Opaque cursor for forward pagination',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Filter by trace ID' })
  @IsOptional()
  @IsUUID()
  traceId?: string;

  @ApiPropertyOptional({ description: 'Filter by agent identifier' })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    enum: AGENT_ACTION_STATUSES,
    description: 'Filter by action status',
  })
  @IsOptional()
  @IsIn([...AGENT_ACTION_STATUSES])
  status?: string;

  @ApiPropertyOptional({
    enum: AGENT_ACTION_TIERS,
    description: 'Filter by policy tier',
  })
  @IsOptional()
  @IsIn([...AGENT_ACTION_TIERS])
  tier?: string;

  @ApiPropertyOptional({ description: 'Filter by entity type' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ description: 'Filter by entity ID' })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Start of created_at range (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End of created_at range (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

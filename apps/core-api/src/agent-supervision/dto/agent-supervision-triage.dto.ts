import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export type SupervisionTriageKind =
  'PENDING_APPROVAL' | 'CUSTOMER_WAITING' | 'OVERDUE_LOANER';

export type SupervisionTriageAllowedAction = 'APPROVE_REJECT' | 'OPEN_RECORD';

export class QueryAgentSupervisionTriageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous triage list response.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class AgentSupervisionTriageItemDto {
  @ApiProperty({
    enum: ['PENDING_APPROVAL', 'CUSTOMER_WAITING', 'OVERDUE_LOANER'],
  })
  kind!: SupervisionTriageKind;

  @ApiProperty()
  entity_id!: string;

  @ApiProperty({ description: 'Authorized site that owns this inbox item.' })
  site_id!: string;

  @ApiProperty({
    description: 'Stable machine reason code for ordering and display.',
  })
  reason!: string;

  @ApiProperty()
  created_at!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  due_at!: string | null;

  @ApiProperty({
    description: 'In-app path to the underlying record.',
  })
  record_link!: string;

  @ApiProperty({ enum: ['APPROVE_REJECT', 'OPEN_RECORD'] })
  allowed_action!: SupervisionTriageAllowedAction;
}

export class AgentSupervisionTriageListResponseDto {
  @ApiProperty({ type: [AgentSupervisionTriageItemDto] })
  data!: AgentSupervisionTriageItemDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  next_cursor!: string | null;
}

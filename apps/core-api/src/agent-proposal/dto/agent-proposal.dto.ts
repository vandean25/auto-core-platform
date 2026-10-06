import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  ArrayMinSize,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AgentPolicyTier, AgentProposalStatus } from '@prisma/client';

export class QueryAgentProposalsDto {
  @ApiPropertyOptional({
    enum: AgentProposalStatus,
    description: 'Filter by proposal status',
  })
  @IsOptional()
  @IsEnum(AgentProposalStatus)
  status?: AgentProposalStatus;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 50,
    description: 'Maximum number of items to return',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RejectAgentProposalDto {
  @ApiPropertyOptional({
    description: 'Reason for rejecting the proposal',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class BatchApplyAgentProposalsDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class BatchApplyAgentProposalResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['applied', 'failed'] })
  status!: 'applied' | 'failed';

  @ApiPropertyOptional({ type: String })
  error?: string;

  @ApiPropertyOptional({ type: Object })
  proposal?: object;
}

export class BatchApplyAgentProposalsResponseDto {
  @ApiProperty({ type: [BatchApplyAgentProposalResultDto] })
  results!: BatchApplyAgentProposalResultDto[];
}

export class CreateAgentProposalDto {
  @ApiProperty({ example: 'workshop_order.add_line' })
  @IsString()
  @IsNotEmpty()
  action_type!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  payload_json!: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  preview_json?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Optional correlation trace ID (UUID)' })
  @IsOptional()
  @IsUUID()
  trace_id?: string;

  @ApiPropertyOptional({
    enum: AgentPolicyTier,
    default: AgentPolicyTier.PROPOSE,
  })
  @IsOptional()
  @IsEnum(AgentPolicyTier)
  tier?: AgentPolicyTier;
}

export class SubmitPendingAgentActionDto {
  @ApiProperty({ example: 'workshop_order.add_line' })
  @IsString()
  @IsNotEmpty()
  action_type!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  payload_json!: Record<string, unknown>;
}

export class AgentProposalEffectiveSummaryDto {
  @ApiProperty({ type: String, nullable: true })
  target_type!: string | null;

  @ApiProperty({ type: String, nullable: true })
  target_id!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  amount_eur!: number | null;
}

export class AgentProposalResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenant_id!: string;

  @ApiProperty()
  trace_id!: string;

  @ApiProperty()
  action_type!: string;

  @ApiProperty({ enum: AgentPolicyTier })
  tier!: AgentPolicyTier;

  @ApiProperty({ enum: AgentProposalStatus })
  status!: AgentProposalStatus;

  @ApiProperty({ type: 'object', additionalProperties: true })
  payload_json!: Record<string, unknown>;

  @ApiProperty({ type: AgentProposalEffectiveSummaryDto })
  effective_summary!: AgentProposalEffectiveSummaryDto;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    nullable: true,
  })
  preview_json!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true })
  created_by_agent!: string | null;

  @ApiProperty({ type: String, nullable: true })
  decided_by!: string | null;

  @ApiProperty({ type: String, nullable: true })
  decided_at!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty()
  expires_at!: string;

  @ApiProperty()
  created_at!: string;

  @ApiProperty()
  updated_at!: string;
}

export class AgentProposalListResponseDto {
  @ApiProperty({ type: [AgentProposalResponseDto] })
  data!: AgentProposalResponseDto[];
}

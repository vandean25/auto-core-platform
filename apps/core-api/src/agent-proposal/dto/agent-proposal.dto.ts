import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  preview_json!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  decided_by!: string | null;

  @ApiPropertyOptional({ nullable: true })
  decided_at!: string | null;

  @ApiPropertyOptional({ nullable: true })
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

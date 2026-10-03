import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AgentPolicyTier } from '@prisma/client';
import type { AgentPolicyConditions } from '../agent-policy.types.js';

export class AgentPolicyConditionsDto implements AgentPolicyConditions {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  amount_max?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  customer_facing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reversible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  affects_legal_document?: boolean;
}

export class AgentPolicyRuleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  action_type!: string;

  @ApiProperty({ enum: AgentPolicyTier })
  tier!: AgentPolicyTier;

  @ApiProperty({ type: AgentPolicyConditionsDto })
  conditions!: AgentPolicyConditionsDto;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  version!: number;

  @ApiProperty({ enum: ['platform', 'tenant'] })
  source!: 'platform' | 'tenant';

  @ApiProperty()
  created_at!: string;

  @ApiProperty()
  updated_at!: string;
}

export class AgentPolicyRuleListResponseDto {
  @ApiProperty({ type: [AgentPolicyRuleResponseDto] })
  data!: AgentPolicyRuleResponseDto[];
}

export class UpsertAgentPolicyRuleDto {
  @ApiProperty({ enum: AgentPolicyTier })
  @IsEnum(AgentPolicyTier)
  tier!: AgentPolicyTier;

  @ApiPropertyOptional({ type: AgentPolicyConditionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentPolicyConditionsDto)
  conditions?: AgentPolicyConditionsDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AgentPolicyEvaluateContextDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount_eur?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  customer_facing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reversible?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  affects_legal_document?: boolean;
}

export class AgentPolicyEvaluateRequestDto {
  @ApiProperty({ example: 'workshop_order.add_line' })
  @IsString()
  action_type!: string;

  @ApiPropertyOptional({ type: AgentPolicyEvaluateContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentPolicyEvaluateContextDto)
  context?: AgentPolicyEvaluateContextDto;
}

export class AgentPolicyEvaluationResponseDto {
  @ApiProperty({ enum: AgentPolicyTier })
  tier!: AgentPolicyTier;

  @ApiProperty({ type: [String] })
  reasons!: string[];

  @ApiProperty({ nullable: true })
  rule_id!: string | null;

  @ApiProperty({ nullable: true })
  rule_version!: number | null;
}

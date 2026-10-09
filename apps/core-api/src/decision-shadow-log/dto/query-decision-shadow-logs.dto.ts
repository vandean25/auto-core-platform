import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { DecisionUseCase } from '../../decision/decision.constants.js';
import { DECISION_SHADOW_USE_CASES } from '../decision-shadow-log.types.js';

export class QueryDecisionShadowLogsDto {
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

  @ApiPropertyOptional({
    enum: DECISION_SHADOW_USE_CASES,
    description: 'Filter by decision use case',
  })
  @IsOptional()
  @IsIn([...DECISION_SHADOW_USE_CASES])
  useCase?: DecisionUseCase;

  @ApiPropertyOptional({ description: 'Start of created_at range (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'End of created_at range (ISO-8601). A date-only value includes the whole UTC day.',
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

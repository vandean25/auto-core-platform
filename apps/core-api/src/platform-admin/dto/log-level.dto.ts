import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  VALID_LOG_LEVELS,
  type AppLogLevel,
} from '../../common/logging/log-level.service';

export class UpdateLogLevelDto {
  @ApiProperty({
    enum: VALID_LOG_LEVELS,
    description: 'The target operational log level',
    example: 'debug',
  })
  @IsIn(VALID_LOG_LEVELS)
  level!: AppLogLevel;

  @ApiPropertyOptional({
    description:
      'Duration in minutes for temporary override (required for debug/verbose; default 30, max 1440)',
    minimum: 1,
    maximum: 1440,
    example: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;
}

export class LogLevelOverrideDto {
  @ApiProperty({ enum: VALID_LOG_LEVELS, example: 'debug' })
  level!: AppLogLevel;

  @ApiPropertyOptional({ example: '2026-08-14T18:00:00.000Z' })
  expiresAt?: string;

  @ApiPropertyOptional({ example: 'user-uuid' })
  updatedBy?: string;

  @ApiProperty({ example: '2026-08-14T17:30:00.000Z' })
  updatedAt!: string;
}

export class LogLevelResponseDto {
  @ApiProperty({ enum: VALID_LOG_LEVELS, example: 'debug' })
  currentLevel!: AppLogLevel;

  @ApiProperty({ enum: VALID_LOG_LEVELS, example: 'log' })
  defaultLevel!: AppLogLevel;

  @ApiPropertyOptional({ type: LogLevelOverrideDto })
  override?: LogLevelOverrideDto;
}

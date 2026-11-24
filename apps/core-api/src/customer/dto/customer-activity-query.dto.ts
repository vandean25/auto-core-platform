import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
} from '../activity/customer-activity.cursor.js';

export class CustomerActivityQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor from meta.nextCursor of the previous page',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Maximum items per page',
    minimum: 1,
    maximum: MAX_ACTIVITY_LIMIT,
    default: DEFAULT_ACTIVITY_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ACTIVITY_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Comma-separated list of activity source types to include',
    example: 'invoice,credit_note',
  })
  @IsOptional()
  @IsString()
  types?: string;
}

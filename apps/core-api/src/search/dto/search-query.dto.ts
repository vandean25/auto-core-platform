import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SEARCH_RESULT_TYPES, type SearchResultType } from '../search.types.js';

export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MAX_LIMIT = 10;

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function splitCommaList(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export class SearchQueryDto {
  @ApiProperty({
    description:
      'Search text. At least 2 characters; a purely numeric input may be 1 character.',
    example: 'RE-2026-0012',
  })
  @Transform(({ value }) => trimIfString(value))
  @IsString()
  @MaxLength(100)
  @Matches(/^(\d+|.{2,})$/s, {
    message: 'q must have at least 2 characters (1 if it is only digits)',
  })
  q!: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Comma-separated result types. Defaults to every type the session role may see.',
    example: 'customer,vehicle',
  })
  @IsOptional()
  @Transform(({ value }) => splitCommaList(value))
  @IsArray()
  @ArrayUnique()
  @IsIn(SEARCH_RESULT_TYPES, { each: true })
  types?: SearchResultType[];

  @ApiPropertyOptional({
    minimum: 1,
    maximum: SEARCH_MAX_LIMIT,
    default: SEARCH_DEFAULT_LIMIT,
    description: 'Maximum results per type.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit?: number;
}

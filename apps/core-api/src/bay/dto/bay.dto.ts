import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseOptionalBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

function parseOptionalNumber(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return Number(value);
}

export class CreateBayDto {
  @ApiProperty()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateBayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ListBaysQueryDto {
  @ApiPropertyOptional({
    description: 'Include inactive bays when true',
  })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value as unknown))
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ description: 'Page number (1-based)', minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value as unknown))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value as unknown))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class BayResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class BaysListMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class BaysListResponseDto {
  @ApiProperty({ type: [BayResponseDto] })
  data!: BayResponseDto[];

  @ApiProperty({ type: BaysListMetaDto })
  meta!: BaysListMetaDto;
}

export class BayDeleteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  deleted?: boolean;
}

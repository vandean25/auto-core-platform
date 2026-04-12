import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsUUID,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsInt,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class LaborOperationFitmentDto {
  @ApiProperty({ description: 'Vehicle make' })
  @IsString()
  @IsNotEmpty()
  make: string;

  @ApiProperty({ description: 'Vehicle model' })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiPropertyOptional({ description: 'Year from (inclusive)' })
  @IsOptional()
  @IsInt()
  yearFrom?: number;

  @ApiPropertyOptional({ description: 'Year to (inclusive)' })
  @IsOptional()
  @IsInt()
  yearTo?: number;

  @ApiPropertyOptional({ description: 'Engine code' })
  @IsOptional()
  @IsString()
  engineCode?: string;
}

export class CreateLaborOperationDto {
  @ApiProperty({ description: 'Unique operation code' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Operation description' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Standard allocated work hours (>= 0)',
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  standardAw: number;

  @ApiProperty({ description: 'Hourly rate (> 0)', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  hourlyRate: number;

  @ApiPropertyOptional({
    description:
      'Internal cost per operation (overrides category default for cost tracking)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  internalCost?: number;

  @ApiPropertyOptional({ description: 'Category ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Fitments for this operation',
    type: [LaborOperationFitmentDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LaborOperationFitmentDto)
  fitments?: LaborOperationFitmentDto[];
}

export class UpdateLaborOperationDto extends PartialType(
  CreateLaborOperationDto,
) {}

export class ListLaborOperationsQueryDto {
  @ApiPropertyOptional({
    description: 'Search term matching code or description',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Page number (1-based)', minimum: 1 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number(value),
  )
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['code', 'description', 'standardAw', 'hourlyRate', 'createdAt'],
  })
  @IsOptional()
  @IsIn(['code', 'description', 'standardAw', 'hourlyRate', 'createdAt'])
  sortField?:
    | 'code'
    | 'description'
    | 'standardAw'
    | 'hourlyRate'
    | 'createdAt';

  @ApiPropertyOptional({ description: 'Sort direction', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

// ── Response DTOs ─────────────────────────────────────────────────────────

export class LaborOperationCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class LaborOperationFitmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  make: string;

  @ApiProperty()
  model: string;

  @ApiPropertyOptional({ nullable: true })
  yearFrom: number | null;

  @ApiPropertyOptional({ nullable: true })
  yearTo: number | null;

  @ApiPropertyOptional({ nullable: true })
  engineCode: string | null;
}

export class LaborOperationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  standardAw: number;

  @ApiProperty()
  hourlyRate: number;

  @ApiPropertyOptional({ nullable: true })
  internalCost: number | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  categoryId: string | null;

  @ApiPropertyOptional({
    type: () => LaborOperationCategoryDto,
    nullable: true,
  })
  category: LaborOperationCategoryDto | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [LaborOperationFitmentResponseDto] })
  fitments: LaborOperationFitmentResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedLaborOperationsMetaDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class PaginatedLaborOperationsResponseDto {
  @ApiProperty({ type: [LaborOperationResponseDto] })
  data: LaborOperationResponseDto[];

  @ApiProperty({ type: () => PaginatedLaborOperationsMetaDto })
  meta: PaginatedLaborOperationsMetaDto;
}

export class SoftDeleteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  isActive: boolean;
}

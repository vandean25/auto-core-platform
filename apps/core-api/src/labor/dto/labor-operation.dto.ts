import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsUUID,
  Min,
  IsArray,
  ValidateNested,
  IsInt,
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
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Operation description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Standard allocated work hours (>= 0)', minimum: 0 })
  @IsNumber()
  @Min(0)
  standardAw: number;

  @ApiProperty({ description: 'Hourly rate (> 0)', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  hourlyRate: number;

  @ApiPropertyOptional({ description: 'Internal cost' })
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

export class UpdateLaborOperationDto extends PartialType(CreateLaborOperationDto) {}

export class ListLaborOperationsQueryDto {
  @ApiPropertyOptional({ description: 'Search term matching code or description' })
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
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['code', 'description', 'standardAw', 'hourlyRate', 'createdAt'],
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ description: 'Sort direction', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortDirection?: 'asc' | 'desc';
}

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateLaborCategoryDto {
  @ApiProperty({ description: 'Unique name for the labor category' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the category' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Sort order for display purposes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({ description: 'Parent category ID (max depth: 1 level)', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @ApiPropertyOptional({ description: 'Default hourly rate for operations in this category' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  default_hourly_rate?: number;

  @ApiPropertyOptional({ description: 'Whether the category is active' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateLaborCategoryDto extends PartialType(CreateLaborCategoryDto) {}

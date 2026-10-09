import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarginRoundingStrategy } from '@prisma/client';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class MarginRuleBrandDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Bosch' })
  name!: string;
}

export class MarginRuleRevenueGroupDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'Parts' })
  name!: string;
}

export class MarginRuleResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({ example: 'tenant-123' })
  tenant_id!: string;

  @ApiProperty({ example: 'Standard Markup' })
  name!: string;

  @ApiProperty({ example: 0 })
  priority!: number;

  @ApiPropertyOptional({ type: Number, example: 1, nullable: true })
  brand_id!: number | null;

  @ApiPropertyOptional({ type: () => MarginRuleBrandDto, nullable: true })
  brand?: MarginRuleBrandDto | null;

  @ApiPropertyOptional({ type: Number, example: 1, nullable: true })
  revenue_group_id!: number | null;

  @ApiPropertyOptional({
    type: () => MarginRuleRevenueGroupDto,
    nullable: true,
  })
  revenue_group?: MarginRuleRevenueGroupDto | null;

  @ApiPropertyOptional({ type: Number, example: 10.0, nullable: true })
  cost_min!: number | null;

  @ApiPropertyOptional({ type: Number, example: 100.0, nullable: true })
  cost_max!: number | null;

  @ApiPropertyOptional({ type: Number, example: 35.0, nullable: true })
  markup_percent!: number | null;

  @ApiProperty({ example: false })
  use_supplier_rrp!: boolean;

  @ApiProperty({
    enum: MarginRoundingStrategy,
    example: MarginRoundingStrategy.NONE,
  })
  rounding!: MarginRoundingStrategy;

  @ApiProperty({ example: true })
  is_active!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class PriceJumpThresholdResponseDto {
  @ApiProperty({ description: 'Price jump threshold percentage', example: 20 })
  price_jump_threshold_percent!: number;

  @ApiPropertyOptional({
    description: 'Alias for price jump threshold percentage',
    example: 20,
  })
  threshold_percent?: number;
}

export class UpdatePriceJumpThresholdDto {
  @ApiPropertyOptional({
    description: 'Price jump threshold percentage',
    example: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  price_jump_threshold_percent?: number;

  @ApiPropertyOptional({
    description: 'Price jump threshold percentage (alias)',
    example: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999.99)
  threshold_percent?: number;
}

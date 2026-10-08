import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarginRoundingStrategy } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateMarginRuleDto {
  @ApiProperty({
    description: 'Name of the margin rule',
    example: 'Standard Parts Margin',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description: 'Rule priority (lowest number evaluated first)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({
    description: 'Optional Brand ID to scope this rule to',
    example: 1,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  brand_id?: number | null;

  @ApiPropertyOptional({
    description: 'Optional Revenue Group ID to scope this rule to',
    example: 1,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  revenue_group_id?: number | null;

  @ApiPropertyOptional({
    description: 'Minimum cost price for rule to apply',
    example: 0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost_min?: number | null;

  @ApiPropertyOptional({
    description: 'Maximum cost price for rule to apply',
    example: 100,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost_max?: number | null;

  @ApiPropertyOptional({
    description: 'Markup percentage to add to cost',
    example: 30.0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  markup_percent?: number | null;

  @ApiPropertyOptional({
    description: 'Whether to use supplier recommended retail price (UVP)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  use_supplier_rrp?: boolean;

  @ApiPropertyOptional({
    description: 'Price rounding strategy',
    enum: MarginRoundingStrategy,
    example: MarginRoundingStrategy.NONE,
    default: MarginRoundingStrategy.NONE,
  })
  @IsOptional()
  @IsEnum(MarginRoundingStrategy)
  rounding?: MarginRoundingStrategy;

  @ApiPropertyOptional({
    description: 'Whether the rule is active',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

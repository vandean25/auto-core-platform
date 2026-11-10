import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateInventoryItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  cost_price!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  retail_price!: number;

  @ApiPropertyOptional({ type: 'integer' })
  @IsInt()
  @IsOptional()
  brandId?: number;
}

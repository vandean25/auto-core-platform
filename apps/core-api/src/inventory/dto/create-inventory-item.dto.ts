import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  IsInt,
} from 'class-validator';

export class CreateInventoryItemDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0)
  cost_price!: number;

  @IsNumber()
  @Min(0)
  retail_price!: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsInt()
  @IsOptional()
  brandId?: number;

  @IsInt()
  @IsOptional()
  revenue_group_id?: number;
}

import { Type } from 'class-transformer';
import {
  IsArray,
  IsDecimal,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateSalesOrderItemDto {
  @IsUUID()
  @IsOptional()
  catalog_item_id?: string;

  @IsString()
  description!: string;

  @IsNumber()
  quantity!: number;

  @IsNumber()
  unit_price!: number;

  @IsNumber()
  @IsOptional()
  tax_rate?: number;
}

export class CreateSalesOrderDto {
  @IsUUID()
  customer_id!: string;

  @IsUUID()
  @IsOptional()
  vehicle_id?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderItemDto)
  items!: CreateSalesOrderItemDto[];
}

import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsInt,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseOrderItemDto {
  @IsString()
  @IsNotEmpty()
  catalogItemId: string;

  @IsInt()
  quantity: number;

  @IsNumber()
  unitCost: number;
}

export class CreatePurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  vendorId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}

import {
  IsArray,
  ValidateNested,
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string; // purchase_order_item.id

  @IsInt()
  quantity: number;

  @IsString()
  @IsOptional()
  locationId?: string;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];
}

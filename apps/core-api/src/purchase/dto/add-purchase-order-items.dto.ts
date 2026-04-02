import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseOrderItemDto } from './create-purchase-order.dto';

export class AddPurchaseOrderItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}

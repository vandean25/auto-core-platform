import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PurchaseOrderItemDto } from './create-purchase-order.dto';

export class AddPurchaseOrderItemsDto {
  @ApiProperty({
    type: [PurchaseOrderItemDto],
    description: 'Items to add to the purchase order',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}

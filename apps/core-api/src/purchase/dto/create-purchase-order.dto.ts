import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsInt,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PurchaseOrderItemDto {
  @ApiProperty({
    description: 'Catalog item ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  catalogItemId!: string;

  @ApiProperty({
    description: 'Quantity ordered',
    example: 5,
  })
  @IsInt()
  quantity!: number;

  @ApiProperty({
    description: 'Unit cost',
    example: 10.5,
  })
  @IsNumber()
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({
    description: 'Vendor ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  vendorId!: string;

  @ApiProperty({
    type: [PurchaseOrderItemDto],
    description: 'Items to include in the purchase order',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}

import {
  IsArray,
  ValidateNested,
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  itemId!: string; // purchase_order_item.id

  @ApiProperty({
    example: 1.5,
    minimum: 0.001,
    multipleOf: 0.001,
    type: 'number',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsString()
  @IsOptional()
  locationId?: string;
}

export class ReceivePurchaseOrderDto {
  @ApiProperty({ type: () => [ReceiveItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items!: ReceiveItemDto[];
}

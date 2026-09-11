import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class RequisitionPurchaseOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  reservationId!: string;

  @ApiProperty({
    description:
      'Clerk-confirmed unit cost for this reservation slice. Must be a JSON number.',
    example: 10.5,
    minimum: 0,
    type: 'number',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost!: number;
}

export class CreateRequisitionPurchaseOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vendorId!: string;

  @ApiProperty({ type: [RequisitionPurchaseOrderItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RequisitionPurchaseOrderItemDto)
  items!: RequisitionPurchaseOrderItemDto[];
}

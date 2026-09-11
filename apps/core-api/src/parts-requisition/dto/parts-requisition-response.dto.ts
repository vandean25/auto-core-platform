import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartsReservationStatus, PartsRequisitionStatus } from '@prisma/client';

export class PartsRequisitionLineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  reservationId!: string;

  @ApiProperty({ format: 'uuid' })
  workshopTaskLineItemId!: string;

  @ApiProperty({ format: 'uuid' })
  workshopOrderId!: string;

  @ApiProperty()
  workshopOrderNumber!: string;

  @ApiProperty()
  itemNo!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, example: '1.500' })
  quantity!: string;

  @ApiProperty({ enum: PartsReservationStatus })
  status!: PartsReservationStatus;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  purchaseOrderItemId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class PartsRequisitionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty()
  vehicleMakeBrandId!: number;

  @ApiProperty({ enum: PartsRequisitionStatus })
  status!: PartsRequisitionStatus;

  @ApiProperty({ type: [PartsRequisitionLineResponseDto] })
  lines!: PartsRequisitionLineResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

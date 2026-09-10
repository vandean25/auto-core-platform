import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartsReservationKind, PartsReservationStatus } from '@prisma/client';

export class PartsReservationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  workshopTaskLineItemId!: string;

  @ApiProperty({ type: String, example: '1.500' })
  quantity!: string;

  @ApiProperty({ type: String, example: '0.000' })
  quantityReceived!: string;

  @ApiProperty({ type: String, example: '0.000' })
  quantityConsumed!: string;

  @ApiProperty({ type: String, example: '0.000' })
  quantityStaged!: string;

  @ApiProperty({ type: String, example: '0.000' })
  quantityReturned!: string;

  @ApiProperty({ enum: PartsReservationKind })
  kind!: PartsReservationKind;

  @ApiProperty({ enum: PartsReservationStatus })
  status!: PartsReservationStatus;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  locationId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

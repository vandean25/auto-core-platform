import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Min } from 'class-validator';

export class CreatePartsReservationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workshopTaskLineItemId!: string;

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

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  locationId!: string;
}

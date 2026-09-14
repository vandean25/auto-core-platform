import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class ConsumePartsReservationDto {
  @ApiProperty({ example: 1.5, minimum: 0.001, multipleOf: 0.001 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
}

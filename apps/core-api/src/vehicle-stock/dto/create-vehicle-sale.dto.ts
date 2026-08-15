import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVehicleSaleDto {
  @ApiProperty()
  @IsUUID()
  vehicle_id!: string;

  @ApiProperty()
  @IsUUID()
  customer_id!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  sale_price!: number;
}

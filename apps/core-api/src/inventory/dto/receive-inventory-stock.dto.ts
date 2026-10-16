import { IsNumber, IsUUID, Min } from 'class-validator';

export class ReceiveInventoryStockDto {
  @IsUUID()
  locationId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

import { IsNotEmpty, IsNumber, IsString, IsUUID, MaxLength } from 'class-validator';

export class AdjustInventoryStockDto {
  @IsUUID()
  locationId!: string;

  /** Signed correction: positive adds stock, negative removes stock. */
  @IsNumber()
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

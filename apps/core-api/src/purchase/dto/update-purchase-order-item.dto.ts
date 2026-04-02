import { IsOptional, IsInt, IsNumber } from 'class-validator';

export class UpdatePurchaseOrderItemDto {
  @IsOptional()
  @IsInt()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  unitCost?: number;
}

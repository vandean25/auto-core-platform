import { IsOptional, IsInt, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePurchaseOrderItemDto {
  @ApiPropertyOptional({
    description: 'Updated quantity',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Updated unit cost',
    example: 25.5,
  })
  @IsOptional()
  @IsNumber()
  unitCost?: number;
}

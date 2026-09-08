import { IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePurchaseOrderItemDto {
  @ApiPropertyOptional({
    description: 'Updated quantity',
    example: 10,
    minimum: 0.001,
    multipleOf: 0.001,
    type: 'number',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Updated unit cost',
    example: 25.5,
    minimum: 0,
    type: 'number',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost?: number;
}

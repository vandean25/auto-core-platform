import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockAdjustmentReason } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class AdjustInventoryStockDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  locationId!: string;

  /** Signed correction: positive adds stock, negative removes stock. */
  @ApiProperty()
  @IsNumber()
  quantity!: number;

  @ApiProperty({
    enum: StockAdjustmentReason,
    enumName: 'StockAdjustmentReason',
  })
  @IsEnum(StockAdjustmentReason)
  reason!: StockAdjustmentReason;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}

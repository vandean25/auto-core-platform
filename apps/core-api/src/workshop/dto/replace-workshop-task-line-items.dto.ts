import { WorkshopLineItemType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReplaceWorkshopTaskLineItemDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing line id for in-place update; omit to insert.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ enum: WorkshopLineItemType })
  @IsEnum(WorkshopLineItemType)
  type!: WorkshopLineItemType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  itemNo!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    example: 1.5,
    minimum: 0.001,
    multipleOf: 0.001,
    type: 'number',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Type(() => Number)
  qty!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitPrice!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  laborOperationId?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  standardAw?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  actualHours?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  internalCostRate?: number;
}

export class ReplaceWorkshopTaskLineItemsDto {
  @ApiProperty({
    minimum: 0,
    type: 'integer',
    description: 'Version read before applying the patch.',
  })
  @IsInt()
  @Min(0)
  expectedLineItemsVersion!: number;

  @ApiProperty({
    type: () => [ReplaceWorkshopTaskLineItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplaceWorkshopTaskLineItemDto)
  items!: ReplaceWorkshopTaskLineItemDto[];
}

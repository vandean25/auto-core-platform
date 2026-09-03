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
import { ApiProperty } from '@nestjs/swagger';

class WorkshopTaskLineItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsEnum(WorkshopLineItemType)
  type!: WorkshopLineItemType;

  @IsString()
  @IsNotEmpty()
  itemNo!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  qty!: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitPrice!: number;

  @IsOptional()
  @IsUUID()
  laborOperationId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  standardAw?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  actualHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  internalCostRate?: number;
}

export class ReplaceWorkshopTaskLineItemsDto {
  @ApiProperty({
    minimum: 0,
    description: 'Version read before applying the patch.',
  })
  @IsInt()
  @Min(0)
  expectedLineItemsVersion!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkshopTaskLineItemDto)
  items!: WorkshopTaskLineItemDto[];
}

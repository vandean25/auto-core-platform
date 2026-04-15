import { WorkshopLineItemType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class WorkshopTaskLineItemDto {
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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkshopTaskLineItemDto)
  items!: WorkshopTaskLineItemDto[];
}

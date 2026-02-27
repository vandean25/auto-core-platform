import { WorkshopLineItemType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class WorkshopTaskLineItemDto {
  @IsEnum(WorkshopLineItemType)
  type: WorkshopLineItemType;

  @IsString()
  @IsNotEmpty()
  itemNo: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0.01)
  qty: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class ReplaceWorkshopTaskLineItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkshopTaskLineItemDto)
  items: WorkshopTaskLineItemDto[];
}


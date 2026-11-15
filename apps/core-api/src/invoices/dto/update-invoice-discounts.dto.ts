import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class UpdateInvoiceDiscountLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiPropertyOptional({
    enum: DiscountType,
    enumName: 'DiscountType',
    nullable: true,
  })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  discountValue?: number | null;
}

export class UpdateInvoiceDiscountsDto {
  @ApiPropertyOptional({
    enum: DiscountType,
    enumName: 'DiscountType',
    nullable: true,
  })
  @IsOptional()
  @IsEnum(DiscountType)
  globalDiscountType?: DiscountType | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  globalDiscountValue?: number | null;

  @ApiPropertyOptional({ type: [UpdateInvoiceDiscountLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoiceDiscountLineDto)
  lineItems?: UpdateInvoiceDiscountLineDto[];
}

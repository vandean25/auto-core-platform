import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsDateString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePurchaseInvoiceLineDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  purchaseOrderItemId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  quantity!: number;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  unitPrice!: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  taxRate?: number;
}

export class CreatePurchaseInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  vendorId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  vendorInvoiceNumber!: string;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  invoiceDate!: string;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  dueDate!: string;

  @ApiProperty({ type: [CreatePurchaseInvoiceLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseInvoiceLineDto)
  items!: CreatePurchaseInvoiceLineDto[];
}

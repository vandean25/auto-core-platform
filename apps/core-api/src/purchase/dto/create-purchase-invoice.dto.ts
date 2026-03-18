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

export class CreatePurchaseInvoiceLineDto {
  @IsUUID()
  @IsOptional()
  purchaseOrderItemId?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @IsNumber()
  @IsNotEmpty()
  unitPrice: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  taxRate: number;
}

export class CreatePurchaseInvoiceDto {
  @IsUUID()
  @IsNotEmpty()
  vendorId: string;

  @IsString()
  @IsNotEmpty()
  vendorInvoiceNumber: string;

  @IsDateString()
  @IsNotEmpty()
  invoiceDate: string;

  @IsDateString()
  @IsNotEmpty()
  dueDate: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseInvoiceLineDto)
  items: CreatePurchaseInvoiceLineDto[];
}

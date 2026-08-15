import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VehiclePurchaseSellerType } from '@prisma/client';

export class PatchVehiclePurchaseDto {
  @ApiPropertyOptional({ enum: VehiclePurchaseSellerType })
  @IsOptional()
  @IsEnum(VehiclePurchaseSellerType)
  seller_type?: VehiclePurchaseSellerType;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsUUID()
  vendor_id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsUUID()
  customer_id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  make?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  engine_code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  mileage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  key_number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registration_certificate_no?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  purchase_price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsUUID()
  location_id?: string | null;
}

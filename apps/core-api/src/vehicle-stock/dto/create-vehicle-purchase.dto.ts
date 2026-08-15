import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
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

export class CreateVehiclePurchaseDto {
  @ApiProperty({ enum: VehiclePurchaseSellerType })
  @IsEnum(VehiclePurchaseSellerType)
  seller_type!: VehiclePurchaseSellerType;

  @ApiPropertyOptional()
  @ValidateIf((dto: CreateVehiclePurchaseDto) => dto.seller_type === 'VENDOR')
  @IsUUID()
  vendor_id?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: CreateVehiclePurchaseDto) => dto.seller_type === 'CUSTOMER')
  @IsUUID()
  customer_id?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  vin!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  make!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;

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

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  purchase_price!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  location_id?: string;
}

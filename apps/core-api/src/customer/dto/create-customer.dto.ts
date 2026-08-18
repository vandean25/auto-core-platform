import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { CustomerType } from '@prisma/client';

export class CreateCustomerDto {
  @ApiPropertyOptional({ enum: CustomerType, enumName: 'CustomerType' })
  @IsEnum(CustomerType)
  @IsOptional()
  type?: CustomerType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  company_name?: string;

  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiProperty()
  @IsString()
  last_name!: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  vat_id?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address_street?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address_city?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address_zip?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address_country?: string;
}

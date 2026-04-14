import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { CustomerType } from '@prisma/client';

export class CreateCustomerDto {
  @IsEnum(CustomerType)
  @IsOptional()
  type?: CustomerType;

  @IsString()
  @IsOptional()
  company_name?: string;

  @IsString()
  first_name!: string;

  @IsString()
  last_name!: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  vat_id?: string;

  @IsString()
  @IsOptional()
  address_street?: string;

  @IsString()
  @IsOptional()
  address_city?: string;

  @IsString()
  @IsOptional()
  address_zip?: string;

  @IsString()
  @IsOptional()
  address_country?: string;
}

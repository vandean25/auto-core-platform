import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { CustomerType, DisplayLanguage } from '@prisma/client';

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

  // The advisor confirms at intake that this address is for order communication (ADR-0025 §8). Null is refused
  // rather than skipped, because IsOptional would let it through to the NOT NULL column.
  @ApiPropertyOptional()
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsBoolean()
  contact_email_ok?: boolean;

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

  @ApiPropertyOptional({
    enum: DisplayLanguage,
    enumName: 'DisplayLanguage',
    nullable: true,
  })
  @IsEnum(DisplayLanguage)
  @IsOptional()
  preferred_language?: DisplayLanguage | null;
}

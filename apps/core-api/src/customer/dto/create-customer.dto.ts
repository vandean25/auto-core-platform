import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CustomerType, DisplayLanguage } from '@prisma/client';

export class CreateCustomerDto {
  @ApiPropertyOptional({ enum: CustomerType, enumName: 'CustomerType' })
  @IsEnum(CustomerType)
  @IsOptional()
  type?: CustomerType;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  company_name?: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  first_name!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  last_name!: string;

  // A form sends an empty field as "". The address is optional, so blank text means no address (null clears it on a
  // PATCH, and is stored as no address on create); only real text is checked as an address.
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsEmail()
  @MaxLength(254)
  @IsOptional()
  email?: string | null;

  // The advisor confirms at intake that this address is for order communication (ADR-0025 §8). Null is refused
  // rather than skipped, because IsOptional would let it through to the NOT NULL column.
  @ApiPropertyOptional()
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsBoolean()
  contact_email_ok?: boolean;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsString()
  @MaxLength(32)
  @IsOptional()
  vat_id?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  address_street?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  address_city?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  address_zip?: string;

  // Rest accepts a free-text country (the MCP schema is restricted to an ISO code), so only a generous cap applies here.
  @ApiPropertyOptional({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
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

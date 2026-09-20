import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SUPPORTED_LEGAL_ENTITY_COUNTRIES = ['AT', 'DE'] as const;
export type SupportedLegalEntityCountry =
  (typeof SUPPORTED_LEGAL_ENTITY_COUNTRIES)[number];

export class CreateLegalEntityDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: SUPPORTED_LEGAL_ENTITY_COUNTRIES })
  @IsIn(SUPPORTED_LEGAL_ENTITY_COUNTRIES)
  countryIso!: SupportedLegalEntityCountry;
}

export class UpdateLegalEntityDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressStreet?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  addressZip?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressCity?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  taxNumber?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  vatId?: string;

  @ApiPropertyOptional({ maxLength: 34 })
  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string;

  @ApiPropertyOptional({ maxLength: 11 })
  @IsOptional()
  @IsString()
  @MaxLength(11)
  bic?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 254 })
  @IsOptional()
  @ValidateIf((_, value) => typeof value === 'string' && value.trim() !== '')
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  registrationNumber?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  registrationCourt?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  representatives?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  paymentTermsText?: string;
}

export class LegalEntitySellerReadinessDto {
  @ApiProperty()
  is_ready!: boolean;

  @ApiProperty({ type: [String] })
  missing_fields!: string[];
}

export class LegalEntityResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenant_id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: SUPPORTED_LEGAL_ENTITY_COUNTRIES })
  country_iso!: SupportedLegalEntityCountry;

  @ApiProperty()
  is_active!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  address_street!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address_line2!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address_zip!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address_city!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  tax_number!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  vat_id!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  iban!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bic!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bank_name!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  registration_number!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  registration_court!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  representatives!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  payment_terms_days!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  payment_terms_text!: string | null;

  @ApiProperty({ type: LegalEntitySellerReadinessDto })
  seller_readiness!: LegalEntitySellerReadinessDto;
}

export class CreateSiteOpeningHourDto {
  @ApiProperty({ minimum: 1, maximum: 7 })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty()
  @IsBoolean()
  isClosed!: boolean;

  @ApiProperty({ example: '07:30' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  openTime!: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closeTime!: string;
}

export class CreateSiteDto {
  @ApiProperty()
  @IsString()
  legalEntityId!: string;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressStreet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressZip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCountry?: string;

  @ApiPropertyOptional({ example: 'Europe/Vienna' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ minimum: 15, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(60)
  slotMinutes?: number;

  @ApiPropertyOptional({ example: 'AT' })
  @IsOptional()
  @IsString()
  holidayCountryIso?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  holidaySubdivisionCode?: string;

  @ApiPropertyOptional({ type: [CreateSiteOpeningHourDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSiteOpeningHourDto)
  openingHours?: CreateSiteOpeningHourDto[];
}

export class UpdateSiteDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressStreet?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressZip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSiteMembershipDto {
  @ApiProperty()
  @IsString()
  userId!: string;
}

/**
 * PATCH /api/me/active-site body (ruling 9). `siteId: null` clears the active
 * site (membership revoke / site deactivation recovery).
 */
export class SetActiveSiteDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Site id to activate from GET /api/me/sites, or null to clear.',
  })
  @IsOptional()
  @IsUUID()
  siteId!: string | null;
}

export class MeSiteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  legalEntityId!: string;

  @ApiPropertyOptional()
  legalEntityName?: string;
}

export class ActiveSiteResponseDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  activeSiteId!: string | null;
}

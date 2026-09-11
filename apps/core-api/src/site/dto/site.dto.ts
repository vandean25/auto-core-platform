import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
  Matches,
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

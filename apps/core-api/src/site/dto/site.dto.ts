import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const SUPPORTED_LEGAL_ENTITY_COUNTRIES = ['AT', 'DE'] as const;
export type SupportedLegalEntityCountry =
  (typeof SUPPORTED_LEGAL_ENTITY_COUNTRIES)[number];

export class CreateLegalEntityDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(SUPPORTED_LEGAL_ENTITY_COUNTRIES)
  countryIso!: SupportedLegalEntityCountry;
}

export class CreateSiteDto {
  @IsString()
  legalEntityId!: string;

  @IsString()
  @MaxLength(64)
  code!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  addressStreet?: string;

  @IsOptional()
  @IsString()
  addressCity?: string;

  @IsOptional()
  @IsString()
  addressZip?: string;

  @IsOptional()
  @IsString()
  addressCountry?: string;
}

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  addressStreet?: string;

  @IsOptional()
  @IsString()
  addressCity?: string;

  @IsOptional()
  @IsString()
  addressZip?: string;

  @IsOptional()
  @IsString()
  addressCountry?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSiteMembershipDto {
  @IsString()
  userId!: string;
}

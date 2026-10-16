import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisplayLanguage } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, ValidateIf } from 'class-validator';
import { DEFAULT_FORMAT_LOCALE } from '../../common/i18n/display-language.js';

export class UserLocalePreferencesResponseDto {
  @ApiProperty({
    enum: DisplayLanguage,
    enumName: 'DisplayLanguage',
    nullable: true,
  })
  locale!: DisplayLanguage | null;

  @ApiProperty({ enum: DisplayLanguage, enumName: 'DisplayLanguage' })
  effectiveLocale!: DisplayLanguage;

  @ApiProperty({ enum: DisplayLanguage, enumName: 'DisplayLanguage' })
  defaultLocale!: DisplayLanguage;

  @ApiProperty({ example: DEFAULT_FORMAT_LOCALE })
  formatLocale!: string;
}

export class PatchUserLocalePreferencesDto {
  @ApiPropertyOptional({
    enum: DisplayLanguage,
    enumName: 'DisplayLanguage',
    nullable: true,
    description: 'Set de/en or null to follow the active tenant default.',
  })
  @IsOptional()
  @ValidateIf((_dto, value: unknown) => value !== null)
  @IsEnum(DisplayLanguage)
  locale?: DisplayLanguage | null;
}

export class TenantLocaleSettingsResponseDto {
  @ApiProperty({ enum: DisplayLanguage, enumName: 'DisplayLanguage' })
  default_locale!: DisplayLanguage;

  @ApiProperty({ example: DEFAULT_FORMAT_LOCALE })
  format_locale!: string;
}

export class PatchTenantLocaleSettingsDto {
  @ApiProperty({ enum: DisplayLanguage, enumName: 'DisplayLanguage' })
  @IsIn(['de', 'en'])
  default_locale!: DisplayLanguage;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export class VoiceTranslationSettingsResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'Target translation language code used for mechanic voice notes.',
    example: 'de',
  })
  targetLanguageCode!: string;

  @ApiPropertyOptional({
    description:
      'Google Cloud project id used for speech/translation requests.',
    nullable: true,
    type: String,
  })
  googleProjectId?: string | null;

  @ApiProperty({
    description: 'Google Cloud location for Speech-to-Text V2 resources.',
    example: 'global',
  })
  googleLocation!: string;

  @ApiProperty({
    description: 'Whether a Google service account credential is configured.',
  })
  hasGoogleCredential!: boolean;

  @ApiProperty()
  updatedAt!: Date;
}

export class UpdateVoiceTranslationSettingsDto {
  @ApiPropertyOptional({
    description:
      'Target translation language code used for mechanic voice notes.',
    example: 'de',
  })
  @IsOptional()
  @IsString()
  @Matches(LANGUAGE_CODE_PATTERN)
  targetLanguageCode?: string;

  @ApiPropertyOptional({
    description:
      'Google Cloud project id used for speech/translation requests.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MinLength(3)
  googleProjectId?: string | null;

  @ApiPropertyOptional({
    description: 'Google Cloud location for Speech-to-Text V2 resources.',
    example: 'global',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  googleLocation?: string;

  @ApiPropertyOptional({
    description:
      'Google service account JSON credentials. The API stores this encrypted and never returns the raw value.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MinLength(100)
  googleServiceAccountJson?: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  PUBLIC_API_SCOPES,
  type PublicApiScope,
} from '../../public-api-scopes.js';

export const TENANT_API_KEY_STATUSES = [
  'ACTIVE',
  'REVOKED',
  'EXPIRED',
] as const;
export type TenantApiKeyStatus = (typeof TENANT_API_KEY_STATUSES)[number];

export class CreateTenantApiKeyDto {
  @ApiProperty({ maxLength: 120, description: 'Label shown in the key list.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({
    isArray: true,
    enum: PUBLIC_API_SCOPES,
    minItems: 1,
    description:
      'Read scopes granted to the key. Write scopes are not available in v1.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn([...PUBLIC_API_SCOPES], { each: true })
  scopes!: PublicApiScope[];

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Optional expiry. Must be in the future.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class TenantApiKeyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    example: 'acp_live_3f9a2c1b',
    description:
      'Display prefix only. The secret is never returned again after creation.',
  })
  keyPrefix!: string;

  @ApiProperty({ isArray: true, enum: PUBLIC_API_SCOPES })
  scopes!: string[];

  @ApiProperty({ enum: TENANT_API_KEY_STATUSES })
  status!: TenantApiKeyStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  createdByEmail?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastUsedAt?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  expiresAt?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  revokedAt?: Date | null;
}

export class TenantApiKeyCreatedResponseDto extends TenantApiKeyResponseDto {
  @ApiProperty({
    example:
      'acp_live_3f9a2c1b-7d4e-4f2a-9b8c-1234567890ab_<64 hex characters>',
    description:
      'Full API key. Returned exactly once, at creation. Store it now; it cannot be retrieved again.',
  })
  token!: string;
}

export class TenantApiKeyListResponseDto {
  @ApiProperty({ type: [TenantApiKeyResponseDto] })
  data!: TenantApiKeyResponseDto[];
}

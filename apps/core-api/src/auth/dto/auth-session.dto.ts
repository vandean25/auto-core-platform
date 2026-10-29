import {
  DisplayLanguage,
  PlatformAdminRole,
  TenantMemberRole,
} from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';
import { DEFAULT_FORMAT_LOCALE } from '../../common/i18n/display-language.js';
import type { CountryCapabilities } from '../../common/country-pack/country-pack.registry.js';

export class EffectiveCapabilitiesDto implements CountryCapabilities {
  @ApiProperty({ type: Boolean })
  nova!: boolean;

  @ApiProperty({ type: Boolean })
  pickerl57a!: boolean;

  @ApiProperty({ type: Boolean })
  kaufvertragAt!: boolean;

  @ApiProperty({ type: Boolean })
  willhabenExport!: boolean;
}

export class SwitchTenantDto {
  @ApiProperty({ format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  tenantId!: string;
}

export class AuthSessionTenantDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

export class AuthSessionMembershipDto {
  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  tenantName!: string;

  @ApiProperty()
  tenantSlug!: string;

  @ApiProperty({ enum: TenantMemberRole, enumName: 'TenantMemberRole' })
  role!: TenantMemberRole;

  @ApiProperty()
  isActive!: boolean;
}

export class AuthSessionResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: AuthSessionTenantDto })
  activeTenant!: AuthSessionTenantDto;

  @ApiProperty({ enum: TenantMemberRole, enumName: 'TenantMemberRole' })
  activeRole!: TenantMemberRole;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  activeSiteId!: string | null;

  @ApiProperty({ type: [AuthSessionMembershipDto] })
  memberships!: AuthSessionMembershipDto[];

  @ApiPropertyOptional({
    enum: PlatformAdminRole,
    enumName: 'PlatformAdminRole',
  })
  platformRole?: PlatformAdminRole;

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

  @ApiProperty({ type: EffectiveCapabilitiesDto, nullable: true })
  effectiveCapabilities!: EffectiveCapabilitiesDto | null;
}

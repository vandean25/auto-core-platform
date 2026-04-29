import { PlatformAdminRole, TenantMemberRole } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

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

  @ApiProperty({ type: [AuthSessionMembershipDto] })
  memberships!: AuthSessionMembershipDto[];

  @ApiPropertyOptional({
    enum: PlatformAdminRole,
    enumName: 'PlatformAdminRole',
  })
  platformRole?: PlatformAdminRole;
}

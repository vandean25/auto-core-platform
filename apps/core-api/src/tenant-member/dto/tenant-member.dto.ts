import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantMemberRole } from '@prisma/client';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseOptionalBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

function parseOptionalNumber(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return Number(value);
}

export class InviteTenantMemberDto {
  @ApiProperty()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: TenantMemberRole, enumName: 'TenantMemberRole' })
  @IsEnum(TenantMemberRole)
  role!: TenantMemberRole;
}

export class UpdateTenantMemberDto {
  @ApiPropertyOptional({ enum: TenantMemberRole, enumName: 'TenantMemberRole' })
  @IsOptional()
  @IsEnum(TenantMemberRole)
  role?: TenantMemberRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListTenantMembersQueryDto {
  @ApiPropertyOptional({ description: 'Search by email or user name' })
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  search?: string;

  @ApiPropertyOptional({
    description: 'Include inactive memberships when true',
  })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value as unknown))
  includeInactive?: boolean;

  @ApiPropertyOptional({ description: 'Page number (1-based)', minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value as unknown))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value as unknown))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class TenantMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  firstName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastName?: string | null;

  @ApiProperty({ enum: TenantMemberRole, enumName: 'TenantMemberRole' })
  role!: TenantMemberRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class TenantMembersListMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class TenantMembersListResponseDto {
  @ApiProperty({ type: [TenantMemberResponseDto] })
  data!: TenantMemberResponseDto[];

  @ApiProperty({ type: TenantMembersListMetaDto })
  meta!: TenantMembersListMetaDto;
}

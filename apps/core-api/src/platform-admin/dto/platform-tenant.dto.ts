import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantPlan } from '@prisma/client';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseOptionalNumber(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return Number(value);
}

function parseOptionalBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export class ListPlatformTenantsQueryDto {
  @ApiPropertyOptional({ description: 'Search by tenant name or slug' })
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  search?: string;

  @ApiPropertyOptional({ description: 'Include inactive tenants when true' })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value as unknown))
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ minimum: 1 })
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

export class CreatePlatformTenantDto {
  @ApiProperty()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Lowercase slug used for tenant routing and lookup' })
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiProperty({ enum: TenantPlan, enumName: 'TenantPlan' })
  @IsEnum(TenantPlan)
  plan!: TenantPlan;
}

export class UpdatePlatformTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ApiPropertyOptional({ enum: TenantPlan, enumName: 'TenantPlan' })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PlatformTenantResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: TenantPlan, enumName: 'TenantPlan' })
  plan!: TenantPlan;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  memberCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class PlatformTenantListMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class PlatformTenantListResponseDto {
  @ApiProperty({ type: [PlatformTenantResponseDto] })
  data!: PlatformTenantResponseDto[];

  @ApiProperty({ type: PlatformTenantListMetaDto })
  meta!: PlatformTenantListMetaDto;
}
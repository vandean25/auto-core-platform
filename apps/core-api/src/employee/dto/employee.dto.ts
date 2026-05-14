import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeRole } from '@prisma/client';

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

const LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export class CreateEmployeeDto {
  @ApiProperty()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  @IsEnum(EmployeeRole)
  role!: EmployeeRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Link this employee to a User account by User.id (Postgres UUID). ' +
      'Required for mechanics so resolveMechanic() can identify them from the session.',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description:
      'Preferred source language for this employee voice notes (BCP-47).',
    nullable: true,
    example: 'pl-PL',
  })
  @IsOptional()
  @IsString()
  @Matches(LANGUAGE_CODE_RE)
  motherLanguageCode?: string | null;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Link (or unlink) this employee to a User account. ' +
      'Pass the User.id (Postgres UUID) to link, or null to unlink. ' +
      'Required for mechanics to enable server-side session resolution (ADR-0014 §1).',
  })
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({
    description:
      'Preferred source language for this employee voice notes (BCP-47).',
    nullable: true,
    example: 'pl-PL',
  })
  @IsOptional()
  @IsString()
  @Matches(LANGUAGE_CODE_RE)
  motherLanguageCode?: string | null;
}

export class ListEmployeesQueryDto {
  @ApiPropertyOptional({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @ApiPropertyOptional({
    description: 'Include inactive employees when true',
  })
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value as unknown))
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional({ description: 'Page number (1-based)', minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value as unknown))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseOptionalNumber(value as unknown))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class EmployeeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  role!: EmployeeRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'The linked User.id for this employee, or null if not linked.',
  })
  userId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Preferred source language for this employee voice notes (BCP-47).',
    example: 'pl-PL',
  })
  motherLanguageCode!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class EmployeesListMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class EmployeesListResponseDto {
  @ApiProperty({ type: [EmployeeResponseDto] })
  data!: EmployeeResponseDto[];

  @ApiProperty({ type: EmployeesListMetaDto })
  meta!: EmployeesListMetaDto;
}

export class EmployeeDeleteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  deleted?: boolean;
}

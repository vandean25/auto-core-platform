import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanerVehicleStatus } from '@prisma/client';

function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseOptionalBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

export class CreateLoanerVehicleDto {
  @ApiProperty()
  @IsUUID()
  vehicleId!: string;

  @ApiProperty()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @ApiPropertyOptional({ enum: LoanerVehicleStatus })
  @IsOptional()
  @IsEnum(LoanerVehicleStatus)
  status?: LoanerVehicleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  dailyRateCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  insuranceNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateLoanerVehicleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => trimIfString(value as unknown))
  @IsString()
  @IsNotEmpty()
  displayName?: string;

  @ApiPropertyOptional({ enum: LoanerVehicleStatus })
  @IsOptional()
  @IsEnum(LoanerVehicleStatus)
  status?: LoanerVehicleStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  dailyRateCents?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  insuranceNote?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListLoanerVehiclesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => parseOptionalBoolean(value as unknown))
  @IsBoolean()
  includeInactive?: boolean;
}

export class LoanerAvailabilityQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  from!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  asOf?: string;
}

export class LoanerVehicleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  siteId!: string;

  @ApiProperty()
  vehicleId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: LoanerVehicleStatus })
  status!: LoanerVehicleStatus;

  @ApiProperty({ type: Number, nullable: true })
  dailyRateCents!: number | null;

  @ApiProperty({ type: String, nullable: true })
  insuranceNote!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class LoanerAvailabilityItemDto {
  @ApiProperty({ type: () => LoanerVehicleResponseDto })
  vehicle!: LoanerVehicleResponseDto;

  @ApiProperty()
  available!: boolean;
}

export class LoanerAvailabilityResponseDto {
  @ApiProperty({ type: [LoanerAvailabilityItemDto] })
  data!: LoanerAvailabilityItemDto[];

  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;

  @ApiPropertyOptional()
  asOf?: string;
}

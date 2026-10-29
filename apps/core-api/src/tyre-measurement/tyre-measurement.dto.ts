import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import {
  TyreConstruction,
  TyreSeason,
  TyreVehicleWeightClass,
  TyreWeightClassSource,
  TyreWheelPosition,
  TyreWinterMarking,
} from '@prisma/client';
import { PaginationMetaDto } from '../common/dto/paginated-response.dto.js';
import type {
  TyreEvaluation,
  TyreReasonCode,
  TyreStatus,
} from './tyre-evaluation.js';

function IsHundredthPrecision() {
  return ValidateBy({
    name: 'isHundredthPrecision',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value === Math.round(value * 100) / 100,
    },
  });
}

export class CreateTyreWheelDto {
  @ApiProperty({ enum: TyreWheelPosition })
  @IsEnum(TyreWheelPosition)
  position!: TyreWheelPosition;

  @ApiProperty({ minimum: 0, maximum: 20, multipleOf: 0.01 })
  @IsNumber()
  @IsHundredthPrecision()
  @Min(0)
  @Max(20)
  treadInnerMm!: number;

  @ApiProperty({ minimum: 0, maximum: 20, multipleOf: 0.01 })
  @IsNumber()
  @IsHundredthPrecision()
  @Min(0)
  @Max(20)
  treadMiddleMm!: number;

  @ApiProperty({ minimum: 0, maximum: 20, multipleOf: 0.01 })
  @IsNumber()
  @IsHundredthPrecision()
  @Min(0)
  @Max(20)
  treadOuterMm!: number;

  @ApiProperty({ enum: TyreSeason })
  @IsEnum(TyreSeason)
  season!: TyreSeason;

  @ApiPropertyOptional({ enum: TyreConstruction, default: 'RADIAL' })
  @IsOptional()
  @IsEnum(TyreConstruction)
  construction?: TyreConstruction;

  @ApiPropertyOptional({ enum: TyreWinterMarking, default: 'NONE' })
  @IsOptional()
  @IsEnum(TyreWinterMarking)
  winterMarking?: TyreWinterMarking;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  size?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  dot?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  mediaId?: string | null;
}

export class CreateTyreMeasurementDto {
  @ApiProperty({ type: [CreateTyreWheelDto], minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique((wheel: CreateTyreWheelDto) => wheel.position)
  @ValidateNested({ each: true })
  @Type(() => CreateTyreWheelDto)
  wheels!: CreateTyreWheelDto[];

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Capture time, defaults to now; cannot be in the future.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  measuredAt?: string;

  @ApiPropertyOptional({
    enum: TyreVehicleWeightClass,
    default: 'UP_TO_3500_KG',
  })
  @IsOptional()
  @IsEnum(TyreVehicleWeightClass)
  weightClass?: TyreVehicleWeightClass;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional set belonging to this vehicle and active site.',
  })
  @IsOptional()
  @IsUUID()
  tyreSetId?: string;
}

export class TyreMeasurementQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

class TyreDotResponseDto {
  @ApiProperty({ enum: ['MODERN', 'LEGACY_PRE_2000'] })
  format!: 'MODERN' | 'LEGACY_PRE_2000';
  @ApiProperty()
  productionWeek!: number;
  @ApiProperty({ type: Number, nullable: true })
  productionYear!: number | null;
  @ApiProperty({ type: String, format: 'date', nullable: true })
  productionDate!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  ageMonths!: number | null;
  @ApiProperty()
  minimumAgeMonths!: number;
}

class TyreThresholdsResponseDto {
  @ApiProperty()
  legalMinimumMm!: number;
  @ApiProperty()
  recommendedBelowMm!: number;
  @ApiProperty()
  ordinaryMinimumMm!: number;
}

export class TyreEvaluationResponseDto implements TyreEvaluation {
  @ApiProperty({ enum: [1] })
  version!: 1;
  @ApiProperty({ enum: ['AT_DE_2026_10'] })
  rulesVersion!: 'AT_DE_2026_10';
  @ApiProperty()
  country!: string;
  @ApiProperty({ format: 'date-time' })
  evaluatedAt!: string;
  @ApiProperty({ enum: TyreVehicleWeightClass })
  weightClass!: TyreVehicleWeightClass;
  @ApiProperty({ enum: ['EVALUATED', 'UNSUPPORTED_COUNTRY'] })
  state!: 'EVALUATED' | 'UNSUPPORTED_COUNTRY';
  @ApiProperty({ enum: ['GOOD', 'RECOMMENDED', 'URGENT'], nullable: true })
  status!: TyreStatus | null;
  @ApiProperty({
    isArray: true,
    enum: [
      'TREAD_BELOW_LEGAL_MINIMUM',
      'AT_WINTER_TREAD_INSUFFICIENT',
      'TREAD_REPLACEMENT_RECOMMENDED',
      'DE_ALPINE_MISSING',
      'AT_WINTER_RULE_NOTICE',
      'DOT_CONDITION_CHECK_RECOMMENDED',
      'DOT_REPLACEMENT_RECOMMENDED',
      'DOT_LEGACY_OVER_20_YEARS',
      'UNSUPPORTED_COUNTRY',
    ],
  })
  reasonCodes!: TyreReasonCode[];
  @ApiProperty()
  minimumTreadMm!: number;
  @ApiProperty({ type: TyreThresholdsResponseDto, nullable: true })
  thresholds!: TyreThresholdsResponseDto | null;
  @ApiProperty({ type: TyreDotResponseDto, nullable: true })
  dot!: TyreDotResponseDto | null;
}

export class TyreWheelResponseDto extends CreateTyreWheelDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ type: TyreEvaluationResponseDto })
  evaluation!: TyreEvaluationResponseDto;
}

export class TyreMeasurementResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  siteId!: string;
  @ApiProperty({ format: 'uuid' })
  vehicleId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  workshopOrderId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  checkInId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  tyreSetId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  tyreSetEventId!: string | null;
  @ApiProperty({ format: 'date-time' })
  measuredAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  measuredBy!: string | null;
  @ApiProperty()
  measuredByName!: string;
  @ApiProperty()
  country!: string;
  @ApiProperty({ enum: TyreVehicleWeightClass })
  weightClass!: TyreVehicleWeightClass;
  @ApiProperty({ enum: TyreWeightClassSource })
  weightClassSource!: TyreWeightClassSource;
  @ApiProperty({ type: [TyreWheelResponseDto] })
  wheels!: TyreWheelResponseDto[];
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class TyreMeasurementListResponseDto {
  @ApiProperty({ type: [TyreMeasurementResponseDto] })
  data!: TyreMeasurementResponseDto[];
  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

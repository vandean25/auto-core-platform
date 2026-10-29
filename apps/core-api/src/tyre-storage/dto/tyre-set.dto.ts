import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  TyreRimType,
  TyreSeason,
  TyreSetEventType,
  TyreSetStatus,
  TyreVehicleWeightClass,
} from '@prisma/client';
import {
  CreateTyreWheelDto,
  TyreMeasurementResponseDto,
} from '../../tyre-measurement/tyre-measurement.dto.js';

export class TreadDepthDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  FL?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  FR?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  RL?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  RR?: number;
}

export class CreateTyreSetDto {
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty()
  @IsString()
  label!: string;

  @ApiProperty({ enum: TyreSeason, enumName: 'TyreSeason' })
  @IsEnum(TyreSeason)
  season!: TyreSeason;

  @ApiPropertyOptional({ default: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  tyreCount?: number;

  @ApiPropertyOptional({ enum: TyreRimType, enumName: 'TyreRimType' })
  @IsOptional()
  @IsEnum(TyreRimType)
  rimType?: TyreRimType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: '245/45 R18' })
  @IsOptional()
  @IsString()
  dimension?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dotCodes?: string[];

  @ApiPropertyOptional({ type: TreadDepthDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TreadDepthDto)
  treadDepthMm?: TreadDepthDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conditionNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  binLabel?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  plannedSwapOn?: string;
}

export class UpdateTyreSetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: TyreSeason, enumName: 'TyreSeason' })
  @IsOptional()
  @IsEnum(TyreSeason)
  season?: TyreSeason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  tyreCount?: number;

  @ApiPropertyOptional({ enum: TyreRimType, enumName: 'TyreRimType' })
  @IsOptional()
  @IsEnum(TyreRimType)
  rimType?: TyreRimType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dimension?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dotCodes?: string[];

  @ApiPropertyOptional({ type: TreadDepthDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TreadDepthDto)
  treadDepthMm?: TreadDepthDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conditionNotes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  binLabel?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  plannedSwapOn?: string | null;
}

export class TyreSetLocationActionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @ApiPropertyOptional({ type: TreadDepthDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TreadDepthDto)
  treadDepthMm?: TreadDepthDto;

  @ApiPropertyOptional({
    type: [CreateTyreWheelDto],
    description:
      'Measurements recorded with this event; supported on check-in, check-out and inspection.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique((wheel: CreateTyreWheelDto) => wheel.position)
  @ValidateNested({ each: true })
  @Type(() => CreateTyreWheelDto)
  wheels?: CreateTyreWheelDto[];

  @ApiPropertyOptional({
    enum: TyreVehicleWeightClass,
    description:
      'Weight class for the recorded readings; defaults to UP_TO_3500_KG.',
  })
  @IsOptional()
  @IsEnum(TyreVehicleWeightClass)
  weightClass?: TyreVehicleWeightClass;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workshopOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class TyreSetEventResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TyreSetEventType, enumName: 'TyreSetEventType' })
  eventType!: TyreSetEventType;

  @ApiProperty()
  occurredAt!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  workshopOrderId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  fromLocationId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  toLocationId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  odometer!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  note!: string | null;
}

export class TyreSetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  vehicleId!: string | null;

  @ApiProperty()
  siteId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  locationId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  locationCode!: string | null;

  @ApiProperty()
  label!: string;

  @ApiProperty({ enum: TyreSeason, enumName: 'TyreSeason' })
  season!: TyreSeason;

  @ApiProperty()
  tyreCount!: number;

  @ApiProperty({ enum: TyreRimType, enumName: 'TyreRimType' })
  rimType!: TyreRimType;

  @ApiPropertyOptional({ nullable: true, type: String })
  brand!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  model!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  dimension!: string | null;

  @ApiProperty({ type: [String] })
  dotCodes!: string[];

  @ApiPropertyOptional({ nullable: true })
  treadDepthMm!: Record<string, number> | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  conditionNotes!: string | null;

  @ApiProperty({ enum: TyreSetStatus, enumName: 'TyreSetStatus' })
  status!: TyreSetStatus;

  @ApiPropertyOptional({ nullable: true, type: String })
  storedSince!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  plannedSwapOn!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  binLabel!: string | null;

  @ApiPropertyOptional({ type: [TyreSetEventResponseDto] })
  events?: TyreSetEventResponseDto[];

  @ApiPropertyOptional({
    type: TyreMeasurementResponseDto,
    nullable: true,
    description: 'Most recent tyre measurement linked to this set.',
  })
  latestMeasurement?: TyreMeasurementResponseDto | null;

  @ApiPropertyOptional({ type: String })
  customerName?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  vehiclePlate?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  customerPhone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  customerEmail?: string | null;
}

export class UpdateTyreStorageSettingsDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      type: 'object',
      required: ['recommendedBelowMm'],
      properties: {
        recommendedBelowMm: { type: 'number', maximum: 20 },
        legalMinimumMm: { type: 'number' },
      },
    },
    description:
      'Profile-keyed amber overrides; may only raise defaults. Omission preserves saved values; {} resets them. Legal minima cannot change.',
  })
  @IsOptional()
  @IsObject()
  recommendationOverrides?: Record<
    string,
    { recommendedBelowMm: number; legalMinimumMm?: number }
  >;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  summerSwapMonth!: number;

  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  summerSwapDay!: number;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  winterSwapMonth!: number;

  @ApiProperty({ minimum: 1, maximum: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  winterSwapDay!: number;

  @ApiProperty({ minimum: 1, maximum: 180 })
  @IsInt()
  @Min(1)
  @Max(180)
  dueForSwapDays!: number;
}

export class TyreStorageSettingsResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      required: ['recommendedBelowMm'],
      properties: { recommendedBelowMm: { type: 'number' } },
    },
  })
  @IsObject()
  recommendationOverrides!: Record<string, { recommendedBelowMm: number }>;

  @ApiProperty()
  summerSwapMonth!: number;

  @ApiProperty()
  summerSwapDay!: number;

  @ApiProperty()
  winterSwapMonth!: number;

  @ApiProperty()
  winterSwapDay!: number;

  @ApiProperty()
  dueForSwapDays!: number;
}

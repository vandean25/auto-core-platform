import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
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
} from '@prisma/client';

export class TreadDepthDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  FL?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  FR?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  RL?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
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

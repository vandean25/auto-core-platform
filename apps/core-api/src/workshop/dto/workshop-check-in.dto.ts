import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkshopCheckInStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CHECK_IN_DAMAGE_TYPES,
  CHECK_IN_MAX_DAMAGE_MARKERS,
  CHECK_IN_MAX_ITEMS_LEFT_LENGTH,
  CHECK_IN_MAX_KEY_COUNT,
  CHECK_IN_MAX_NOTES_LENGTH,
  CHECK_IN_MAX_ODOMETER,
  CHECK_IN_MAX_WARNING_LIGHT_LENGTH,
  CHECK_IN_MAX_WARNING_LIGHTS,
  CHECK_IN_TYRE_SEASONS,
} from '../workshop-check-in.rules.js';

export class CheckInConditionDto {
  @ApiProperty({ enum: ['SUMMER', 'WINTER', 'ALL_SEASON', 'UNKNOWN'] })
  @IsString()
  @IsIn([...CHECK_IN_TYRE_SEASONS])
  tyre_season!: string;

  @ApiProperty({ maxLength: CHECK_IN_MAX_NOTES_LENGTH })
  @IsString()
  @MaxLength(CHECK_IN_MAX_NOTES_LENGTH)
  exterior_notes!: string;

  @ApiProperty({ maxLength: CHECK_IN_MAX_NOTES_LENGTH })
  @IsString()
  @MaxLength(CHECK_IN_MAX_NOTES_LENGTH)
  interior_notes!: string;
}

export class CheckInDamageMarkerDto {
  @ApiProperty()
  @IsString()
  zone_id!: string;

  @ApiProperty({ enum: ['SCRATCH', 'DENT', 'CRACK', 'OTHER'] })
  @IsString()
  @IsIn([...CHECK_IN_DAMAGE_TYPES])
  type!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  media_id?: string | null;
}

export class CreateWorkshopCheckInDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class UpdateWorkshopCheckInDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expected_revision!: number;

  @ApiPropertyOptional({ type: CheckInConditionDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CheckInConditionDto)
  condition?: CheckInConditionDto;

  @ApiPropertyOptional({ type: [CheckInDamageMarkerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHECK_IN_MAX_DAMAGE_MARKERS)
  @ValidateNested({ each: true })
  @Type(() => CheckInDamageMarkerDto)
  damage_markers?: CheckInDamageMarkerDto[];

  @ApiPropertyOptional({ maxLength: CHECK_IN_MAX_ITEMS_LEFT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CHECK_IN_MAX_ITEMS_LEFT_LENGTH)
  items_left?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: CHECK_IN_MAX_KEY_COUNT })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CHECK_IN_MAX_KEY_COUNT)
  key_count?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHECK_IN_MAX_WARNING_LIGHTS)
  @IsString({ each: true })
  @MaxLength(CHECK_IN_MAX_WARNING_LIGHT_LENGTH, { each: true })
  warning_lights?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: CHECK_IN_MAX_ODOMETER })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CHECK_IN_MAX_ODOMETER)
  odometer?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  fuel_level?: number;
}

export class WorkshopCheckInResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  workshop_order_id!: string;

  @ApiProperty({ enum: WorkshopCheckInStatus })
  status!: WorkshopCheckInStatus;

  @ApiProperty()
  revision!: number;

  @ApiProperty({ type: Object })
  condition_json!: Record<string, unknown>;

  @ApiProperty({ type: Array })
  damage_markers_json!: unknown[];

  @ApiProperty()
  items_left!: string;

  @ApiProperty()
  key_count!: number;

  @ApiProperty({ type: [String] })
  warning_lights!: string[];

  @ApiProperty()
  odometer!: number;

  @ApiProperty()
  fuel_level!: number;

  @ApiProperty()
  created_at!: string;

  @ApiProperty()
  updated_at!: string;
}

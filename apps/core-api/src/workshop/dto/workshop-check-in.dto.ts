import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkshopCheckInStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { UpdateWorkshopInspectionDto } from './update-workshop-inspection.dto.js';
import {
  CHECK_IN_DAMAGE_TYPES,
  CHECK_IN_MAX_DAMAGE_MARKER_NOTE_LENGTH,
  CHECK_IN_MAX_DAMAGE_MARKERS,
  CHECK_IN_MAX_MEDIA_IDS_PER_DAMAGE_MARKER,
  CHECK_IN_MAX_ITEMS_LEFT_LENGTH,
  CHECK_IN_MAX_KEY_COUNT,
  CHECK_IN_MAX_NOTES_LENGTH,
  CHECK_IN_MAX_ODOMETER,
  CHECK_IN_MAX_WARNING_LIGHT_LENGTH,
  CHECK_IN_MAX_WARNING_LIGHTS,
  CHECK_IN_MAX_SIGNED_BY_NAME_LENGTH,
  CHECK_IN_MIN_SIGNED_BY_NAME_LENGTH,
  CHECK_IN_TYRE_SEASONS,
} from '../workshop-check-in.rules.js';
import { CHECK_IN_ACKNOWLEDGEMENT_VERSION } from '../workshop-check-in-acknowledgement.js';
import { CHECK_IN_ZONE_IDS } from '../workshop-check-in-zones.js';

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
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: [...CHECK_IN_ZONE_IDS] })
  @IsString()
  @IsIn([...CHECK_IN_ZONE_IDS])
  zone_id!: string;

  @ApiProperty({ enum: ['SCRATCH', 'DENT', 'CRACK', 'OTHER'] })
  @IsString()
  @IsIn([...CHECK_IN_DAMAGE_TYPES])
  type!: string;

  @ApiProperty({ maxLength: CHECK_IN_MAX_DAMAGE_MARKER_NOTE_LENGTH })
  @IsString()
  @MaxLength(CHECK_IN_MAX_DAMAGE_MARKER_NOTE_LENGTH)
  note!: string;

  @ApiProperty({
    type: [String],
    maxItems: CHECK_IN_MAX_MEDIA_IDS_PER_DAMAGE_MARKER,
  })
  @IsArray()
  @ArrayMaxSize(CHECK_IN_MAX_MEDIA_IDS_PER_DAMAGE_MARKER)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  media_ids!: string[];
}

export class CreateWorkshopCheckInDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class UpdateWorkshopCheckInInspectionDto extends UpdateWorkshopInspectionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expected_revision!: number;
}

export class CompleteWorkshopCheckInDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expected_revision!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  signature_media_id!: string;

  @ApiProperty({
    minLength: CHECK_IN_MIN_SIGNED_BY_NAME_LENGTH,
    maxLength: CHECK_IN_MAX_SIGNED_BY_NAME_LENGTH,
  })
  @IsString()
  @MinLength(CHECK_IN_MIN_SIGNED_BY_NAME_LENGTH)
  @MaxLength(CHECK_IN_MAX_SIGNED_BY_NAME_LENGTH)
  signed_by_name!: string;

  @ApiProperty({ example: CHECK_IN_ACKNOWLEDGEMENT_VERSION })
  @IsString()
  @Equals(CHECK_IN_ACKNOWLEDGEMENT_VERSION)
  acknowledgement_version!: string;

  @ApiProperty({ enum: ['de', 'en'] })
  @IsIn(['de', 'en'])
  acknowledgement_locale!: 'de' | 'en';

  @ApiProperty()
  @IsBoolean()
  @Equals(true)
  acknowledged!: boolean;
}

export class UpdateWorkshopCheckInDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expected_revision!: number;

  @ApiPropertyOptional({ type: CheckInConditionDto, nullable: false })
  @ValidateIf((_obj, value) => value !== undefined)
  @NotEquals(null)
  @IsObject()
  @ValidateNested()
  @Type(() => CheckInConditionDto)
  condition?: CheckInConditionDto;

  @ApiPropertyOptional({ type: [CheckInDamageMarkerDto], nullable: false })
  @ValidateIf((_obj, value) => value !== undefined)
  @NotEquals(null)
  @IsArray()
  @ArrayMaxSize(CHECK_IN_MAX_DAMAGE_MARKERS)
  @ValidateNested({ each: true })
  @Type(() => CheckInDamageMarkerDto)
  damage_markers?: CheckInDamageMarkerDto[];

  @ApiPropertyOptional({
    maxLength: CHECK_IN_MAX_ITEMS_LEFT_LENGTH,
    nullable: false,
  })
  @ValidateIf((_obj, value) => value !== undefined)
  @NotEquals(null)
  @IsString()
  @MaxLength(CHECK_IN_MAX_ITEMS_LEFT_LENGTH)
  items_left?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: CHECK_IN_MAX_KEY_COUNT,
    nullable: false,
  })
  @ValidateIf((_obj, value) => value !== undefined)
  @NotEquals(null)
  @IsInt()
  @Min(0)
  @Max(CHECK_IN_MAX_KEY_COUNT)
  key_count?: number;

  @ApiPropertyOptional({ type: [String], nullable: false })
  @ValidateIf((_obj, value) => value !== undefined)
  @NotEquals(null)
  @IsArray()
  @ArrayMaxSize(CHECK_IN_MAX_WARNING_LIGHTS)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(CHECK_IN_MAX_WARNING_LIGHT_LENGTH, { each: true })
  warning_lights?: string[];

  @ApiPropertyOptional({
    minimum: 0,
    maximum: CHECK_IN_MAX_ODOMETER,
    nullable: false,
  })
  @ValidateIf((_obj, value) => value !== undefined)
  @NotEquals(null)
  @IsInt()
  @Min(0)
  @Max(CHECK_IN_MAX_ODOMETER)
  odometer?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, nullable: false })
  @ValidateIf((_obj, value) => value !== undefined)
  @NotEquals(null)
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

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  inspection_id!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  content_sha256!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
  })
  completed_at!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  pdf_sha256!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  signed_by_name!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
  })
  signed_at!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  signature_media_id!: string | null;

  @ApiProperty()
  created_at!: string;

  @ApiProperty()
  updated_at!: string;
}

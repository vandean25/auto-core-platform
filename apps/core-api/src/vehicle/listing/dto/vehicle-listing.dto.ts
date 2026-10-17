import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  VehicleListingDescriptionLanguage,
  VehicleListingDesiredState,
  VehicleListingExportState,
  VehicleListingPlatform,
  VehicleListingRemoteState,
  VehicleListingVatDisplay,
} from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class VehicleListingPriceDisplayDto {
  @ApiPropertyOptional({ example: '18990.00' })
  price_gross_eur!: string | null;

  @ApiPropertyOptional({
    enum: VehicleListingVatDisplay,
    enumName: 'VehicleListingVatDisplay',
  })
  vat_display!: VehicleListingVatDisplay | null;

  @ApiPropertyOptional({
    description: 'Draft consumer-facing hint (de-AT), not legal approval.',
  })
  consumer_hint_de!: string | null;

  @ApiProperty()
  nova_included_confirmed!: boolean;

  @ApiProperty()
  mandatory_fees_included_confirmed!: boolean;
}

export class VehicleListingPhotoDto {
  @ApiProperty({ format: 'uuid' })
  media_id!: string;

  @ApiProperty()
  sort_order!: number;

  @ApiProperty({ description: 'SHA-256 of processed listing image bytes' })
  content_sha256!: string;
}

export class VehicleListingChannelDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: VehicleListingPlatform,
    enumName: 'VehicleListingPlatform',
  })
  platform!: VehicleListingPlatform;

  @ApiProperty()
  serializer_profile!: string;

  @ApiProperty()
  mapping_version!: string;

  @ApiProperty({
    enum: VehicleListingDesiredState,
    enumName: 'VehicleListingDesiredState',
  })
  desired_state!: VehicleListingDesiredState;

  @ApiProperty({
    enum: VehicleListingExportState,
    enumName: 'VehicleListingExportState',
  })
  export_state!: VehicleListingExportState;

  @ApiProperty({
    enum: VehicleListingRemoteState,
    enumName: 'VehicleListingRemoteState',
  })
  remote_state!: VehicleListingRemoteState;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  last_export_at!: string | null;

  @ApiPropertyOptional()
  last_export_content_sha256!: string | null;

  @ApiPropertyOptional()
  external_ref!: string | null;
}

export class VehicleListingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  site_id!: string;

  @ApiProperty({ format: 'uuid' })
  vehicle_id!: string;

  @ApiProperty({ format: 'uuid' })
  stock_purchase_id!: string;

  @ApiProperty({ example: 'L0123456789abcdef0123456789abcdef' })
  listing_ref!: string;

  @ApiProperty()
  revision!: number;

  @ApiPropertyOptional()
  title!: string | null;

  @ApiPropertyOptional()
  description!: string | null;

  @ApiProperty({
    enum: VehicleListingDescriptionLanguage,
    enumName: 'VehicleListingDescriptionLanguage',
  })
  description_language!: VehicleListingDescriptionLanguage;

  @ApiPropertyOptional({ type: VehicleListingPriceDisplayDto })
  price_display!: VehicleListingPriceDisplayDto;

  @ApiPropertyOptional()
  equipment_free_text!: string | null;

  @ApiPropertyOptional({ example: 'Car.Limousine' })
  portal_category!: string | null;

  @ApiPropertyOptional()
  export_assertion_damage_free!: boolean | null;

  @ApiPropertyOptional()
  export_assertion_metallic!: boolean | null;

  @ApiPropertyOptional()
  export_assertion_guarantee!: boolean | null;

  @ApiPropertyOptional()
  export_assertion_jahreswagen!: boolean | null;

  @ApiPropertyOptional()
  export_assertion_recommendation!: boolean | null;

  @ApiPropertyOptional()
  export_assertion_demo_vehicle!: boolean | null;

  @ApiProperty()
  content_sha256!: string;

  @ApiProperty({ type: [VehicleListingPhotoDto] })
  photos!: VehicleListingPhotoDto[];

  @ApiProperty({ type: [VehicleListingChannelDto] })
  channels!: VehicleListingChannelDto[];
}

export class CreateVehicleListingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  expected_stock_purchase_id!: string;
}

export class PatchVehicleListingDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expected_revision!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  description?: string | null;

  @ApiPropertyOptional({
    enum: VehicleListingDescriptionLanguage,
    enumName: 'VehicleListingDescriptionLanguage',
  })
  @IsOptional()
  @IsEnum(VehicleListingDescriptionLanguage)
  description_language?: VehicleListingDescriptionLanguage;

  @ApiPropertyOptional({ example: 18990 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  price_gross_eur?: number;

  @ApiPropertyOptional({
    enum: VehicleListingVatDisplay,
    enumName: 'VehicleListingVatDisplay',
  })
  @IsOptional()
  @IsEnum(VehicleListingVatDisplay)
  vat_display?: VehicleListingVatDisplay;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  nova_included_confirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mandatory_fees_included_confirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  equipment_free_text?: string | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  photo_ids?: string[];

  @ApiPropertyOptional({ example: 'Car.Limousine' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  portal_category?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  export_assertion_damage_free?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  export_assertion_metallic?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  export_assertion_guarantee?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  export_assertion_jahreswagen?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  export_assertion_recommendation?: boolean | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  export_assertion_demo_vehicle?: boolean | null;
}

export class PatchVehicleListingChannelDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expected_revision!: number;

  @ApiProperty({
    enum: VehicleListingDesiredState,
    enumName: 'VehicleListingDesiredState',
  })
  @IsEnum(VehicleListingDesiredState)
  desired_state!: VehicleListingDesiredState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  serializer_profile?: string;
}

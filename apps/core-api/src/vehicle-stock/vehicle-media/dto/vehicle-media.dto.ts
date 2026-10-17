import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsObject, IsUUID } from 'class-validator';
import type { VehicleMediaVariantMap } from '../vehicle-media.types.js';

export class VehicleMediaVariantDto {
  @ApiProperty()
  storageKey!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  contentType!: string;
}

export class VehicleMediaDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId!: string;

  @ApiProperty({ format: 'uuid' })
  siteId!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isCover!: boolean;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  contentSha256!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  variants!: Record<string, VehicleMediaVariantDto>;

  @ApiProperty({ format: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class ReorderVehicleMediaDto {
  @ApiProperty({
    type: [String],
    description:
      'Full ordered list of photo ids belonging to this vehicle (tenant-scoped).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  mediaIds!: string[];
}

export function toVehicleMediaDto(row: {
  id: string;
  vehicle_id: string;
  site_id: string;
  sort_order: number;
  is_cover: boolean;
  content_type: string;
  width: number;
  height: number;
  content_sha256: string;
  variant_storage_keys: unknown;
  created_by_user_id: string | null;
  createdAt: Date;
  updatedAt: Date;
}): VehicleMediaDto {
  const rawVariants = row.variant_storage_keys as VehicleMediaVariantMap;
  const variants: Record<string, VehicleMediaVariantDto> = {};
  for (const [name, meta] of Object.entries(rawVariants ?? {})) {
    variants[name] = {
      storageKey: meta.storage_key,
      width: meta.width,
      height: meta.height,
      contentType: meta.content_type,
    };
  }
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    siteId: row.site_id,
    sortOrder: row.sort_order,
    isCover: row.is_cover,
    contentType: row.content_type,
    width: row.width,
    height: row.height,
    contentSha256: row.content_sha256,
    variants,
    createdByUserId: row.created_by_user_id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

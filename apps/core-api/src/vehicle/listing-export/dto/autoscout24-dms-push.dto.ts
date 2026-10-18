import { ApiProperty } from '@nestjs/swagger';
import {
  VehicleListingDmsProvider,
  VehicleListingDmsSyncState,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum Autoscout24DmsPushActionDto {
  UPSERT = 'UPSERT',
  DEACTIVATE = 'DEACTIVATE',
}

export class Autoscout24DmsPushRequestDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotency_key!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  expected_revision!: number;

  @ApiProperty({
    enum: Autoscout24DmsPushActionDto,
    enumName: 'Autoscout24DmsPushActionDto',
  })
  @IsEnum(Autoscout24DmsPushActionDto)
  action!: Autoscout24DmsPushActionDto;
}

export class Autoscout24DmsPushResponseDto {
  @ApiProperty()
  channel_id!: string;

  @ApiProperty({
    enum: VehicleListingDmsProvider,
    enumName: 'VehicleListingDmsProvider',
  })
  provider!: VehicleListingDmsProvider;

  @ApiProperty({
    enum: VehicleListingDmsSyncState,
    enumName: 'VehicleListingDmsSyncState',
  })
  sync_state!: VehicleListingDmsSyncState;

  @ApiProperty({ nullable: true })
  external_listing_id!: string | null;

  @ApiProperty({ nullable: true })
  last_sync_at!: string | null;

  @ApiProperty({ nullable: true })
  last_sync_error_code!: string | null;

  @ApiProperty()
  idempotent_replay!: boolean;
}

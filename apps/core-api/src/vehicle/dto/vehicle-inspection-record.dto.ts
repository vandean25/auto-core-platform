import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  VehicleInspectionRecordSource,
  VehicleInspectionType,
} from '@prisma/client';

export class CreateVehicleInspectionRecordDto {
  @ApiProperty({
    enum: VehicleInspectionType,
    enumName: 'VehicleInspectionType',
  })
  @IsEnum(VehicleInspectionType)
  inspection_type!: VehicleInspectionType;

  @ApiProperty({ type: String, format: 'date' })
  @IsDateString()
  inspected_on!: string;

  @ApiProperty({ minimum: 1980, maximum: 2100 })
  @IsInt()
  @Min(1980)
  @Max(2100)
  plaketten_valid_until_year!: number;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  plaketten_valid_until_month!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  station_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVehicleInspectionRecordDto {
  @ApiPropertyOptional({ type: String, format: 'date' })
  @IsOptional()
  @IsDateString()
  inspected_on?: string;

  @ApiPropertyOptional({ minimum: 1980, maximum: 2100 })
  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(2100)
  plaketten_valid_until_year?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  plaketten_valid_until_month?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  station_name?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class VehicleInspectionRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  vehicle_id!: string;

  @ApiProperty({
    enum: VehicleInspectionType,
    enumName: 'VehicleInspectionType',
  })
  inspection_type!: VehicleInspectionType;

  @ApiProperty({ type: String, format: 'date' })
  inspected_on!: string | Date;

  @ApiProperty()
  plaketten_valid_until_year!: number;

  @ApiProperty()
  plaketten_valid_until_month!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  station_name?: string | null;

  @ApiProperty({
    enum: VehicleInspectionRecordSource,
    enumName: 'VehicleInspectionRecordSource',
  })
  source!: VehicleInspectionRecordSource;

  @ApiProperty({ type: String, required: false, nullable: true })
  notes?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  created_by_user_id?: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

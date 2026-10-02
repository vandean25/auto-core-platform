import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { VEHICLE_NOVA_CLASS_VALUES } from '../vehicle-regulatory.validation.js';

export class VehicleRegulatoryFieldsDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Date of first registration (Erstzulassung)',
  })
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsDateString({ strict: true })
  first_registration_date?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 600,
    description: 'CO₂ emissions WLTP (g/km)',
  })
  @Type(() => Number)
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsInt()
  co2_wltp_g_km?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 600,
    description: 'CO₂ emissions NEDC (g/km), optional legacy value',
  })
  @Type(() => Number)
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsInt()
  co2_nedc_g_km?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Type approval certificate number (Typenschein)',
  })
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  typenschein_no?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: [...VEHICLE_NOVA_CLASS_VALUES],
    description: 'NoVA classification (values may expand in future releases)',
  })
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsIn([...VEHICLE_NOVA_CLASS_VALUES])
  nova_class?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Emission class (e.g. Euro 6d)',
  })
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  emission_class?: string | null;
}

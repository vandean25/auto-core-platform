import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import type {
  EmissionCycle,
  NovaDriveType,
  NovaVehicleClass,
} from '../../nova-calculator/types.js';

const EMISSION_CYCLES: EmissionCycle[] = ['WLTP', 'NEDC'];
const DRIVE_TYPES: NovaDriveType[] = ['BEV', 'FCEV', 'PHEV', 'ICE', 'OTHER'];
const VEHICLE_CLASSES: NovaVehicleClass[] = [
  'passenger_z3',
  'n1_legacy_z6',
  'motorcycle_z1_z2',
];

function transformNumericInput(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

export class NovaCalculateRequestDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiProperty({ minimum: 0 })
  @Transform(({ value }: { value: unknown }) => transformNumericInput(value))
  @IsNumber({ allowNaN: false, allowInfinity: false })
  netPriceEuro!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf(
    (_request: NovaCalculateRequestDto, value: unknown) => value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) => transformNumericInput(value))
  @IsNumber({ allowNaN: false, allowInfinity: false })
  co2GramsPerKm?: number;

  @ApiPropertyOptional({ enum: EMISSION_CYCLES })
  @ValidateIf(
    (request: NovaCalculateRequestDto) =>
      !request.vehicleId || request.emissionCycle !== undefined,
  )
  @IsEnum(EMISSION_CYCLES)
  emissionCycle?: EmissionCycle;

  @ApiPropertyOptional({ enum: DRIVE_TYPES })
  @ValidateIf(
    (request: NovaCalculateRequestDto) =>
      !request.vehicleId || request.driveType !== undefined,
  )
  @IsEnum(DRIVE_TYPES)
  driveType?: NovaDriveType;

  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf(
    (request: NovaCalculateRequestDto) =>
      !request.vehicleId || request.taxableEventDate !== undefined,
  )
  @IsString()
  taxableEventDate?: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsString()
  firstRegistrationDate?: string;

  @ApiPropertyOptional({ enum: VEHICLE_CLASSES })
  @IsOptional()
  @IsEnum(VEHICLE_CLASSES)
  vehicleClass?: NovaVehicleClass;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf(
    (_request: NovaCalculateRequestDto, value: unknown) => value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) => transformNumericInput(value))
  @IsNumber({ allowNaN: false, allowInfinity: false })
  ratedPowerKw?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf(
    (_request: NovaCalculateRequestDto, value: unknown) => value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) => transformNumericInput(value))
  @IsNumber({ allowNaN: false, allowInfinity: false })
  displacementCc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCamperSA?: boolean;
}

export class NovaCalculateResponseDto {
  @ApiProperty() novaAmountEuro!: number;
  @ApiProperty({ type: [String] }) appliedRuleIds!: string[];
  @ApiProperty() tariffVersionId!: string;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty() hasUnverifiedRules!: boolean;
  @ApiProperty() ratePercentApplied!: number;
  @ApiProperty() effectiveCo2GramsPerKm!: number;
}

export class NovaCalculationErrorResponseDto {
  @ApiProperty({
    enum: [
      'MISSING_CO2',
      'INVALID_CO2',
      'INVALID_ISO_DATE',
      'INVALID_NEDC_CYCLE',
      'TARIFF_CLASS_MISMATCH',
      'UNKNOWN_TARIFF_VERSION',
      'INVALID_NET_PRICE',
    ],
  })
  code!: string;

  @ApiProperty() message!: string;
}

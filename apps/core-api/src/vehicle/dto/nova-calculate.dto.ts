import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import type {
  EmissionCycle,
  NovaDriveType,
  NovaImportMode,
  NovaVehicleClass,
} from '../../nova-calculator/types.js';

const EMISSION_CYCLES: EmissionCycle[] = ['WLTP', 'NEDC'];
const DRIVE_TYPES: NovaDriveType[] = ['BEV', 'FCEV', 'PHEV', 'ICE', 'OTHER'];
const VEHICLE_CLASSES: NovaVehicleClass[] = [
  'passenger_z3',
  'n1_legacy_z6',
  'motorcycle_z1_z2',
];
const IMPORT_MODES = ['eu_used_m1', 'third_country', 'previously_exempt'];
const VALUE_BASIS_OPTIONS = ['known_new_net', 'achtelung'];

function isEuUsedM1Request(request: NovaCalculateRequestDto): boolean {
  return request.importMode === 'eu_used_m1';
}

function requiresBodyCalculationFields(
  request: NovaCalculateRequestDto,
): boolean {
  return !isEuUsedM1Request(request) && !request.vehicleId;
}

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

  @ApiPropertyOptional({ enum: IMPORT_MODES })
  @ValidateIf(
    (_request: NovaCalculateRequestDto, value: unknown) => value !== undefined,
  )
  @IsIn(IMPORT_MODES)
  importMode?: NovaImportMode;

  @ApiPropertyOptional({
    description:
      'Wertentwicklung basis; service accepts known_new_net or achtelung',
  })
  @ValidateIf(
    (_request: NovaCalculateRequestDto, value: unknown) => value !== undefined,
  )
  @IsString()
  valueBasis?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf(
    (_request: NovaCalculateRequestDto, value: unknown) => value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) => transformNumericInput(value))
  @IsNumber({ allowNaN: true, allowInfinity: true })
  originalNewNetEuro?: number;

  @ApiPropertyOptional({ enum: EMISSION_CYCLES })
  @ValidateIf(
    (request: NovaCalculateRequestDto) =>
      requiresBodyCalculationFields(request) ||
      (!!request.vehicleId && request.emissionCycle !== undefined) ||
      (isEuUsedM1Request(request) && request.emissionCycle !== undefined),
  )
  @IsIn(EMISSION_CYCLES)
  emissionCycle?: EmissionCycle;

  @ApiPropertyOptional({ enum: DRIVE_TYPES })
  @ValidateIf(
    (request: NovaCalculateRequestDto) =>
      requiresBodyCalculationFields(request) ||
      (!!request.vehicleId && request.driveType !== undefined) ||
      (isEuUsedM1Request(request) && request.driveType !== undefined),
  )
  @IsIn(DRIVE_TYPES)
  driveType?: NovaDriveType;

  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf(
    (request: NovaCalculateRequestDto) =>
      requiresBodyCalculationFields(request) ||
      (!!request.vehicleId && request.taxableEventDate !== undefined) ||
      (isEuUsedM1Request(request) && request.taxableEventDate !== undefined),
  )
  @IsString()
  taxableEventDate?: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsString()
  firstRegistrationDate?: string;

  @ApiPropertyOptional({ enum: VEHICLE_CLASSES })
  @IsOptional()
  @IsIn(VEHICLE_CLASSES)
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

export class NovaValueDevelopmentFactorDto {
  @ApiProperty() numerator!: number;
  @ApiProperty() denominator!: number;
}

export class NovaCalculationIntermediatesDto {
  @ApiProperty() rateRaw!: string;
  @ApiProperty() baseAmountEuro!: number;
  @ApiProperty() malusGrossEuro!: number;
  @ApiProperty() deductionGrossEuro!: number;
  @ApiProperty() fixedBeforeDevelopmentEuro!: number;
  @ApiProperty() fullYearsElapsed!: number;
  @ApiProperty({ type: NovaValueDevelopmentFactorDto })
  valueDevelopmentFactor!: NovaValueDevelopmentFactorDto;
  @ApiProperty() fixedAfterDevelopmentEuro!: number;
  @ApiProperty({ enum: VALUE_BASIS_OPTIONS }) valueBasis!: string;
}

export class NovaCalculateResponseDto {
  @ApiProperty() novaAmountEuro!: number;
  @ApiProperty({ type: [String] }) appliedRuleIds!: string[];
  @ApiProperty() tariffVersionId!: string;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty() hasUnverifiedRules!: boolean;
  @ApiProperty() hasScopeLimitations!: boolean;
  @ApiProperty() ratePercentApplied!: number;
  @ApiProperty() effectiveCo2GramsPerKm!: number;
  @ApiPropertyOptional({ enum: ['first_eu_registration'] })
  tariffSelectionBasis?: 'first_eu_registration';
  @ApiPropertyOptional({ format: 'date' })
  tariffSelectionDate?: string;
  @ApiPropertyOptional({ type: NovaCalculationIntermediatesDto })
  intermediates?: NovaCalculationIntermediatesDto;
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
      'MISSING_IMPORT_MODE',
      'MISSING_FIRST_REGISTRATION',
      'MISSING_TAXABLE_EVENT_DATE',
      'INVALID_IMPORT_DATES',
      'MISSING_VEHICLE_CLASS',
      'UNSUPPORTED_IMPORT_MODE',
      'UNSUPPORTED_IMPORT_CLASS',
      'UNSUPPORTED_HISTORICAL_TARIFF',
      'OUTSIDE_SUPPORTED_SLICE',
      'UNSUPPORTED_DRIVE_TYPE',
      'UNSUPPORTED_EMISSION_CYCLE',
      'UNSUPPORTED_CAMPER_SA',
      'UNSUPPORTED_FRACTIONAL_CO2',
      'MISSING_VALUE_DEVELOPMENT',
      'INVALID_VALUE_BASIS',
      'MISSING_ORIGINAL_NEW_NET',
    ],
  })
  code!: string;

  @ApiProperty() message!: string;
}

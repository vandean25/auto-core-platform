import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export const VALUATION_CONDITIONS = [
  'ROADWORTHY_AVERAGE',
  'POOR',
  'NOT_ROADWORTHY',
] as const;

export class CreateVehicleValuationDto {
  @ApiProperty({ enum: ['MARKET_VALUE'] })
  @IsIn(['MARKET_VALUE'])
  valuationType!: 'MARKET_VALUE';

  @ApiPropertyOptional({ minimum: 0, maximum: 999999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999999)
  mileageKm?: number | null;

  @ApiPropertyOptional({ enum: VALUATION_CONDITIONS })
  @IsOptional()
  @IsIn(VALUATION_CONDITIONS)
  condition?: (typeof VALUATION_CONDITIONS)[number] | null;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'requestedAsOf must be YYYY-MM-DD',
  })
  requestedAsOf?: string;

  @ApiProperty({ enum: ['EUR'] })
  @IsIn(['EUR'])
  currency!: 'EUR';
}

export class VehicleValuationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['QUOTED'] })
  result!: 'QUOTED';

  @ApiProperty()
  amount!: string;

  @ApiProperty({ enum: ['EUR'] })
  currency!: 'EUR';

  @ApiProperty({ enum: ['EUROTAX_AT_AUTOVALUATION'] })
  source!: 'EUROTAX_AT_AUTOVALUATION';

  @ApiProperty({ enum: ['KNOWN'] })
  sourceState!: 'KNOWN';

  @ApiProperty()
  requestedAsOf!: string;

  @ApiProperty()
  providerAsOf!: string;

  @ApiProperty({ enum: ['KNOWN'] })
  asOfState!: 'KNOWN';

  @ApiProperty()
  referenceVersion!: string;

  @ApiProperty({ enum: ['KNOWN'] })
  referenceVersionState!: 'KNOWN';

  @ApiProperty({ example: 'acp-valuation-contract-1' })
  contractVersion!: string;

  @ApiProperty({ type: 'string', nullable: true, enum: [null] })
  nativeId!: null;

  @ApiProperty({ enum: ['NATIVE_ID_UNKNOWN'] })
  nativeIdState!: 'NATIVE_ID_UNKNOWN';

  @ApiProperty()
  nationalCode!: string;

  @ApiProperty()
  mileageKm!: number;

  @ApiProperty({ enum: VALUATION_CONDITIONS })
  condition!: (typeof VALUATION_CONDITIONS)[number];

  @ApiProperty()
  stale!: boolean;

  @ApiProperty()
  createdAt!: string;
}

export class VehicleValuationErrorResponseDto {
  @ApiProperty()
  result!: string;

  @ApiPropertyOptional({ nullable: true })
  amount?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currency?: string | null;

  @ApiPropertyOptional({ nullable: true })
  source?: string | null;

  @ApiPropertyOptional()
  sourceState?: string;

  @ApiPropertyOptional()
  requestedAsOf?: string;

  @ApiPropertyOptional({ nullable: true })
  providerAsOf?: string | null;

  @ApiPropertyOptional()
  asOfState?: string;

  @ApiPropertyOptional({ nullable: true })
  referenceVersion?: string | null;

  @ApiPropertyOptional()
  referenceVersionState?: string;

  @ApiPropertyOptional()
  contractVersion?: string;

  @ApiPropertyOptional({ type: 'string', nullable: true })
  nativeId?: null;

  @ApiPropertyOptional()
  nativeIdState?: string;

  @ApiPropertyOptional({ type: [String] })
  missing?: string[];

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  candidates?: { nationalCode: string; label: string }[];
}

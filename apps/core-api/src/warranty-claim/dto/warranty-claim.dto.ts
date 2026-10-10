import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  WarrantyClaimStatus,
  WarrantyClaimType,
  WorkshopLineItemType,
} from '@prisma/client';
import {
  WARRANTY_CLAIM_MAX_AMOUNT_EUR,
  WARRANTY_CLAIM_MAX_LINES,
  WARRANTY_CLAIM_MAX_TEXT_LENGTH,
} from '../warranty-claim.rules.js';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts `?status=A&status=B` as well as `?status=A,B`. Anything that is not a string is dropped. */
function parseStatusFilter(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  return parts
    .filter((part): part is string => typeof part === 'string')
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export class CreateWarrantyClaimDto {
  @ApiProperty({ enum: WarrantyClaimType })
  @IsEnum(WarrantyClaimType)
  type!: WarrantyClaimType;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: WARRANTY_CLAIM_MAX_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(WARRANTY_CLAIM_MAX_TEXT_LENGTH)
  complaint?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: WARRANTY_CLAIM_MAX_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(WARRANTY_CLAIM_MAX_TEXT_LENGTH)
  causeCorrection?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Claimed amount in EUR, net of VAT.',
    minimum: 0,
    maximum: WARRANTY_CLAIM_MAX_AMOUNT_EUR,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(WARRANTY_CLAIM_MAX_AMOUNT_EUR)
  claimedAmountNet?: number | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Labor and part lines of this workshop order that the claim covers.',
  })
  // Not @IsOptional(): that would let null through, and null would clear every line.
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(WARRANTY_CLAIM_MAX_LINES)
  @IsUUID('all', { each: true })
  lineItemIds?: string[];
}

/**
 * Every field is optional. Content fields are accepted only while the claim is DRAFT; that rule
 * lives in the service, which can see the stored status. An explicit null clears a field.
 */
export class UpdateWarrantyClaimDto {
  @ApiPropertyOptional({ enum: WarrantyClaimType })
  @IsOptional()
  @IsEnum(WarrantyClaimType)
  type?: WarrantyClaimType;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: WARRANTY_CLAIM_MAX_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(WARRANTY_CLAIM_MAX_TEXT_LENGTH)
  complaint?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: WARRANTY_CLAIM_MAX_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(WARRANTY_CLAIM_MAX_TEXT_LENGTH)
  causeCorrection?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Claimed amount in EUR, net of VAT.',
    minimum: 0,
    maximum: WARRANTY_CLAIM_MAX_AMOUNT_EUR,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(WARRANTY_CLAIM_MAX_AMOUNT_EUR)
  claimedAmountNet?: number | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Labor and part lines of this workshop order that the claim covers. Replaces the current set.',
  })
  // Not @IsOptional(): that would let null through, and null would clear every line.
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(WARRANTY_CLAIM_MAX_LINES)
  @IsUUID('all', { each: true })
  lineItemIds?: string[];

  @ApiPropertyOptional({ enum: WarrantyClaimStatus })
  @IsOptional()
  @IsEnum(WarrantyClaimStatus)
  status?: WarrantyClaimStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 120,
    description: 'Claim reference at the OEM, typed in by the advisor.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalReference?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Decision day of the OEM, as YYYY-MM-DD.',
    example: '2026-10-10',
  })
  @IsOptional()
  @Matches(DAY_PATTERN)
  decisionDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decisionNote?: string | null;
}

export class ListWarrantyClaimsQueryDto {
  @ApiPropertyOptional({
    enum: WarrantyClaimStatus,
    isArray: true,
    description:
      'Only claims in these statuses. Repeat the parameter or pass a comma-separated list.',
  })
  @IsOptional()
  @Transform(({ value }) => parseStatusFilter(value))
  @IsArray()
  @IsEnum(WarrantyClaimStatus, { each: true })
  status?: WarrantyClaimStatus[];
}

export class WarrantyClaimLineResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workshopTaskLineItemId!: string;
  @ApiProperty({ enum: WorkshopLineItemType }) lineType!: WorkshopLineItemType;
  @ApiProperty() itemNo!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: '1.000' }) quantity!: string;
  @ApiProperty({ example: '89.90', description: 'EUR, net' })
  unitPrice!: string;
  @ApiProperty({ example: '89.90', description: 'EUR, net' })
  netAmount!: string;
}

export class WarrantyClaimResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workshopOrderId!: string;
  @ApiProperty({ enum: WarrantyClaimType }) type!: WarrantyClaimType;
  @ApiProperty({ enum: WarrantyClaimStatus }) status!: WarrantyClaimStatus;
  @ApiProperty({ nullable: true, type: String }) complaint!: string | null;
  @ApiProperty({ nullable: true, type: String }) causeCorrection!:
    string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '1250.00',
    description: 'EUR, net',
  })
  claimedAmountNet!: string | null;
  @ApiProperty({
    example: '1250.00',
    description: 'EUR, net; sum of the affected lines',
  })
  linesNetAmount!: string;
  @ApiProperty({ nullable: true, type: String }) externalReference!:
    string | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-10-10' })
  decisionDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) decisionNote!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  submittedAt!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  closedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [WarrantyClaimLineResponseDto] })
  lines!: WarrantyClaimLineResponseDto[];
}

export class WarrantyClaimListResponseDto {
  @ApiProperty({ type: [WarrantyClaimResponseDto] })
  data!: WarrantyClaimResponseDto[];
  @ApiProperty({ type: 'object', properties: { total: { type: 'number' } } })
  meta!: { total: number };
}

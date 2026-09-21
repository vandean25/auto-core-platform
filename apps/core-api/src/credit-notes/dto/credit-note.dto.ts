import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreditNoteStatus } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreditNotePartialLineDto {
  @ApiProperty()
  @IsUUID()
  originalItemId!: string;

  @ApiProperty({ example: '1.000' })
  @IsString()
  @IsNotEmpty()
  quantity!: string;
}

export class CreateCreditNoteDto {
  @ApiProperty({ example: '2026-09-21' })
  @IsDateString()
  date!: string;

  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ enum: ['FULL', 'PARTIAL'] })
  @IsEnum(['FULL', 'PARTIAL'] as const)
  mode!: 'FULL' | 'PARTIAL';

  @ApiPropertyOptional({ type: [CreditNotePartialLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((line: CreditNotePartialLineDto) => line.originalItemId)
  @ValidateNested({ each: true })
  @Type(() => CreditNotePartialLineDto)
  lines?: CreditNotePartialLineDto[];
}

export class UpdateCreditNoteDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ example: '2026-09-21' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ type: [CreditNotePartialLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((line: CreditNotePartialLineDto) => line.originalItemId)
  @ValidateNested({ each: true })
  @Type(() => CreditNotePartialLineDto)
  lines?: CreditNotePartialLineDto[];
}

export class FinalizeCreditNoteDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class VoidCreditNoteDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class CreditNoteRemainingLineDto {
  @ApiProperty()
  originalItemId!: string;

  @ApiProperty()
  remainingQuantity!: string;

  @ApiProperty()
  remainingNet!: string;

  @ApiProperty()
  remainingTax!: string;

  @ApiProperty()
  remainingGross!: string;
}

export class CreditNoteItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  originalInvoiceItemId!: string;

  @ApiProperty()
  quantity!: string;

  @ApiProperty({ type: Object, nullable: true })
  snapshot!: Record<string, unknown> | null;
}

export class CreditNoteResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  originalInvoiceId!: string;

  @ApiProperty({ enum: CreditNoteStatus, enumName: 'CreditNoteStatus' })
  status!: CreditNoteStatus;

  @ApiProperty({ type: String, nullable: true })
  creditNumber!: string | null;

  @ApiProperty()
  date!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  totalNet!: string;

  @ApiProperty()
  totalTax!: string;

  @ApiProperty()
  totalGross!: string;

  @ApiProperty({ type: [CreditNoteItemResponseDto] })
  items!: CreditNoteItemResponseDto[];

  @ApiProperty({ type: [CreditNoteRemainingLineDto] })
  remainingLines!: CreditNoteRemainingLineDto[];
}

export class CreditNoteListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

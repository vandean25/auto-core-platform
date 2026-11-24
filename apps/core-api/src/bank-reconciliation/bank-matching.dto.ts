import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankTransactionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BANK_MATCH_REASON } from './bank-match-score.js';

const MAX_ALLOCATIONS = 50;
const MAX_VERSION = 2147483646;
const ALLOCATION_AMOUNT = /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/;
const CONFIRM_SOURCES = ['MANUAL', 'RULES'] as const;

class ConfirmBankAllocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ example: '120.00', pattern: ALLOCATION_AMOUNT.source })
  @IsString()
  @Matches(ALLOCATION_AMOUNT)
  amount!: string;
}

export class ConfirmBankTransactionDto {
  @ApiProperty({ minimum: 1, maximum: MAX_VERSION })
  @IsInt()
  @Min(1)
  @Max(MAX_VERSION)
  transactionVersion!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Allocate the available amount up to the invoice balance. Supply either invoiceId or allocations.',
  })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional({
    type: [ConfirmBankAllocationDto],
    minItems: 1,
    maxItems: MAX_ALLOCATIONS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ALLOCATIONS)
  @ValidateNested({ each: true })
  @Type(() => ConfirmBankAllocationDto)
  allocations?: ConfirmBankAllocationDto[];

  @ApiPropertyOptional({ enum: CONFIRM_SOURCES, default: 'MANUAL' })
  @IsOptional()
  @IsIn(CONFIRM_SOURCES)
  source?: (typeof CONFIRM_SOURCES)[number];
}

class BankTransactionVersionDto {
  @ApiProperty({ minimum: 1, maximum: MAX_VERSION })
  @IsInt()
  @Min(1)
  @Max(MAX_VERSION)
  expectedVersion!: number;
}

export class UndoBankTransactionDto extends BankTransactionVersionDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Reverse this allocation. Without an ID, reverse the latest confirmation or restore an ignored transaction.',
  })
  @IsOptional()
  @IsUUID()
  allocationId?: string;
}

export class IgnoreBankTransactionDto extends BankTransactionVersionDto {
  @ApiProperty({ maxLength: 240 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(240)
  reason!: string;
}

class BankMatchReasonDto {
  @ApiProperty({ enum: BANK_MATCH_REASON })
  code!: (typeof BANK_MATCH_REASON)[keyof typeof BANK_MATCH_REASON];

  @ApiProperty()
  value!: string;
}

class BankSuggestionDto {
  @ApiProperty({ format: 'uuid' })
  invoiceId!: string;

  @ApiProperty()
  invoiceNumber!: string;

  @ApiProperty()
  outstandingAmount!: string;

  @ApiProperty()
  suggestedAmount!: string;

  @ApiProperty()
  remainingInvoiceAmount!: string;

  @ApiProperty()
  unallocatedTransferAmount!: string;

  @ApiProperty()
  score!: number;

  @ApiProperty({ type: [BankMatchReasonDto] })
  reasons!: BankMatchReasonDto[];
}

export class BankSuggestionsDto {
  @ApiProperty({ type: [BankSuggestionDto] })
  data!: BankSuggestionDto[];
}

class BankAllocationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  invoiceId!: string;

  @ApiProperty()
  amount!: string;
}

export class BankTransactionActionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: BankTransactionStatus })
  status!: BankTransactionStatus;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  unallocatedAmount!: string;

  @ApiProperty({ type: [BankAllocationDto] })
  allocations!: BankAllocationDto[];
}

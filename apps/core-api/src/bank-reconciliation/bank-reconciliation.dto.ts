import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankTransactionStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ListCursorPageMetaDto } from '../common/dto/list-cursor-response.dto.js';

export class BankStatementImportResponseDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ format: 'uuid' })
  legalEntityId!: string;

  @ApiProperty()
  receivingIban!: string;

  @ApiProperty({ type: String, nullable: true })
  statementId!: string | null;

  @ApiProperty()
  format!: string;

  @ApiProperty()
  totalEntries!: number;

  @ApiProperty()
  creditEntries!: number;

  @ApiProperty()
  debitEntries!: number;

  @ApiProperty()
  importedCount!: number;

  @ApiProperty()
  duplicateCount!: number;

  @ApiProperty()
  deduplicated!: boolean;
}

export class BankTransactionItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  legal_entity_id!: string;

  @ApiProperty({ format: 'uuid' })
  import_id!: string;

  @ApiProperty()
  receiving_iban!: string;

  @ApiProperty({ example: '2026-11-10' })
  booking_date!: string;

  @ApiProperty({ type: String, nullable: true, example: '2026-11-10' })
  value_date!: string | null;

  @ApiProperty({ example: '1250.50' })
  amount!: string;

  @ApiProperty({ example: 'EUR' })
  currency!: string;

  @ApiProperty()
  is_credit!: boolean;

  @ApiProperty()
  non_eur!: boolean;

  @ApiProperty({ type: String, nullable: true })
  remitter_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  remitter_iban_last4!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reference_text!: string | null;

  @ApiProperty()
  bank_ref!: string;

  @ApiProperty({
    enum: BankTransactionStatus,
    enumName: 'BankTransactionStatus',
  })
  status!: BankTransactionStatus;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: string;
}

export class ListBankTransactionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: BankTransactionStatus,
    enumName: 'BankTransactionStatus',
  })
  @IsOptional()
  @IsEnum(BankTransactionStatus)
  status?: BankTransactionStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  legal_entity_id?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}

export class ListBankTransactionsResponseDto {
  @ApiProperty({ type: [BankTransactionItemDto] })
  data!: BankTransactionItemDto[];

  @ApiProperty({ type: ListCursorPageMetaDto })
  meta!: ListCursorPageMetaDto;
}

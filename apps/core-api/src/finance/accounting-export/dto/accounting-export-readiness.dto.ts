import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACCOUNTING_EXPORT_BLOCKER_CODES,
  ACCOUNTING_EXPORT_DOCUMENT_KINDS,
} from '../accounting-export-codes.js';
import type {
  AccountingExportBlockerCode,
  AccountingExportDocumentKind,
} from '../accounting-export.types.js';
import { AccountingExportBlockerDto } from './accounting-export.dto.js';

export class AccountingExportReadinessQueryDto {
  @ApiProperty()
  @IsUUID()
  legalEntityId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ example: '2026-01-31' })
  @IsDateString()
  dateTo!: string;

  @ApiPropertyOptional({ enum: ACCOUNTING_EXPORT_BLOCKER_CODES })
  @IsOptional()
  @IsIn([...ACCOUNTING_EXPORT_BLOCKER_CODES])
  reason?: AccountingExportBlockerCode;

  @ApiPropertyOptional({ enum: ACCOUNTING_EXPORT_DOCUMENT_KINDS })
  @IsOptional()
  @IsIn([...ACCOUNTING_EXPORT_DOCUMENT_KINDS])
  documentKind?: AccountingExportDocumentKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AccountingExportReadinessReasonDto {
  @ApiProperty({ enum: ACCOUNTING_EXPORT_BLOCKER_CODES })
  code!: AccountingExportBlockerCode;

  @ApiProperty({
    description: 'Distinct documents in the period blocked by this reason.',
  })
  documentCount!: number;
}

export class AccountingExportReadinessDocumentKindDto {
  @ApiProperty({ enum: ACCOUNTING_EXPORT_DOCUMENT_KINDS })
  kind!: AccountingExportDocumentKind;

  @ApiProperty()
  documentCount!: number;

  @ApiProperty()
  exportableCount!: number;

  @ApiProperty()
  blockedCount!: number;
}

export class AccountingExportReadinessSummaryDto {
  @ApiProperty({ description: 'Documents in the period, before any filter.' })
  documentCount!: number;

  @ApiProperty()
  exportableCount!: number;

  @ApiProperty()
  blockedCount!: number;

  @ApiProperty({ type: [AccountingExportReadinessDocumentKindDto] })
  documentKinds!: AccountingExportReadinessDocumentKindDto[];

  @ApiProperty({ type: [AccountingExportReadinessReasonDto] })
  reasons!: AccountingExportReadinessReasonDto[];
}

export class AccountingExportReadinessSiteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

export class AccountingExportReadinessDocumentBlockerDto {
  @ApiProperty({ enum: ACCOUNTING_EXPORT_BLOCKER_CODES })
  code!: AccountingExportBlockerCode;

  @ApiProperty()
  message!: string;
}

export class AccountingExportReadinessDocumentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ACCOUNTING_EXPORT_DOCUMENT_KINDS })
  kind!: AccountingExportDocumentKind;

  @ApiProperty({ type: String, nullable: true })
  number!: string | null;

  @ApiProperty({ example: '2026-01-15' })
  date!: string;

  @ApiProperty({ type: AccountingExportReadinessSiteDto, nullable: true })
  site!: AccountingExportReadinessSiteDto | null;

  @ApiProperty({ enum: ['EXPORTABLE', 'BLOCKED'] })
  status!: 'EXPORTABLE' | 'BLOCKED';

  @ApiProperty({ type: [AccountingExportReadinessDocumentBlockerDto] })
  blockers!: AccountingExportReadinessDocumentBlockerDto[];

  @ApiProperty({
    description:
      'In-app path of the document, where its blockers can be reviewed and fixed.',
    example: '/sales/invoices/0b6f0c4e-2f1a-4d8e-9a57-6c1f2a3b4c5d',
  })
  href!: string;
}

export class AccountingExportReadinessMetaDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  pageCount!: number;
}

export class AccountingExportReadinessResponseDto {
  @ApiProperty()
  legalEntityId!: string;

  @ApiProperty({ example: '2026-01-01' })
  dateFrom!: string;

  @ApiProperty({ example: '2026-01-31' })
  dateTo!: string;

  @ApiProperty({
    description:
      'Whether the lock date covers the period end. Exports require a closed period.',
  })
  periodClosed!: boolean;

  @ApiProperty({ type: String, nullable: true })
  lockDate!: string | null;

  @ApiProperty({ type: AccountingExportReadinessSummaryDto })
  summary!: AccountingExportReadinessSummaryDto;

  @ApiProperty({
    type: [AccountingExportBlockerDto],
    description:
      'Blockers that apply to every export in the period but do not belong to a listed document, such as documents without a legal entity or site.',
  })
  tenantWideBlockers!: AccountingExportBlockerDto[];

  @ApiProperty({ type: [AccountingExportReadinessDocumentDto] })
  data!: AccountingExportReadinessDocumentDto[];

  @ApiProperty({ type: AccountingExportReadinessMetaDto })
  meta!: AccountingExportReadinessMetaDto;
}

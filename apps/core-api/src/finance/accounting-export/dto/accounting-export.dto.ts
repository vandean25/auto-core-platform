import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AccountingExportPeriodDto {
  @ApiProperty()
  @IsUUID()
  legalEntityId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ example: '2026-01-31' })
  @IsDateString()
  dateTo!: string;
}

export class PreviewAccountingExportDto {
  @ApiProperty()
  @IsUUID()
  legalEntityId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  dateFrom!: string;

  @ApiProperty({ example: '2026-01-31' })
  @IsDateString()
  dateTo!: string;
}

export class GenerateAccountingExportDto extends PreviewAccountingExportDto {
  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  previewHash!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  profileVersion!: number;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  acknowledgeOverlap?: boolean;
}

export class AccountingExportBlockerDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional()
  documentId?: string;

  @ApiPropertyOptional({ enum: ['INVOICE', 'CREDIT_NOTE'] })
  documentKind?: 'INVOICE' | 'CREDIT_NOTE';

  @ApiPropertyOptional({ type: String, nullable: true })
  documentNumber?: string | null;
}

export class AccountingExportTotalsBucketDto {
  @ApiProperty()
  account!: string;

  @ApiProperty()
  taxRate!: string;

  @ApiProperty()
  net!: string;

  @ApiProperty()
  tax!: string;

  @ApiProperty()
  gross!: string;
}

export class AccountingExportOverlapSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  dateFrom!: string;

  @ApiProperty()
  dateTo!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  fileSha256!: string;

  @ApiProperty()
  documentCount!: number;
}

export class AccountingExportPreviewResponseDto {
  @ApiProperty()
  legalEntityId!: string;

  @ApiProperty()
  dateFrom!: string;

  @ApiProperty()
  dateTo!: string;

  @ApiProperty()
  profileVersion!: number;

  @ApiProperty()
  previewHash!: string;

  @ApiProperty()
  documentCount!: number;

  @ApiProperty()
  rowCount!: number;

  @ApiProperty({ type: [AccountingExportTotalsBucketDto] })
  totals!: AccountingExportTotalsBucketDto[];

  @ApiProperty({ type: [AccountingExportBlockerDto] })
  blockers!: AccountingExportBlockerDto[];

  @ApiProperty({ type: [AccountingExportOverlapSummaryDto] })
  overlaps!: AccountingExportOverlapSummaryDto[];

  @ApiProperty()
  canGenerate!: boolean;
}

export class AccountingExportCreatedResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty()
  sha256!: string;

  @ApiProperty()
  documentCount!: number;

  @ApiProperty()
  rowCount!: number;

  @ApiProperty()
  createdAt!: string;
}

export class AccountingExportListQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  legalEntityId?: string;
}

export class AccountingExportSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  legalEntityId!: string;

  @ApiProperty()
  dateFrom!: string;

  @ApiProperty()
  dateTo!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty()
  sha256!: string;

  @ApiProperty()
  documentCount!: number;

  @ApiProperty()
  rowCount!: number;

  @ApiProperty()
  byteLength!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true })
  createdByUserId!: string | null;
}

export class AccountingExportDetailDto extends AccountingExportSummaryDto {
  @ApiProperty()
  profileSnapshot!: Record<string, unknown>;

  @ApiProperty()
  documentManifest!: Record<string, unknown>;

  @ApiProperty({ type: [String] })
  siteIds!: string[];
}

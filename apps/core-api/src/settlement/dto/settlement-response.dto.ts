import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FiscalReceiptSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  providerReceiptId!: string;

  @ApiProperty()
  receiptType!: string;

  @ApiProperty()
  state!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  receiptNumber!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  timeSignature!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  cashRegisterSerialNumber!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  qrCodeData!: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  signed!: boolean | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  hints!: string[] | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  providerRequestId!: string | null;
}

export class SettlementPaymentSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  idempotencyKey!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  method!: string;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  externalReceiptNumber!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  externalReceiptDate!: string | null;

  @ApiProperty({ type: [FiscalReceiptSummaryDto] })
  fiscalReceipts!: FiscalReceiptSummaryDto[];
}

export class SettlementResponseDto {
  @ApiProperty()
  invoiceId!: string;

  @ApiProperty()
  invoiceStatus!: string;

  @ApiPropertyOptional({
    enum: ['OFF', 'UNKNOWN', 'REQUIRED_EXTERNAL_KASSE', 'REQUIRED_ACP_RKSV'],
  })
  rksvMode?: string;

  @ApiPropertyOptional({ type: SettlementPaymentSummaryDto, nullable: true })
  payment!: SettlementPaymentSummaryDto | null;
}

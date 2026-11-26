import { ApiProperty } from '@nestjs/swagger';
import { StockAdjustmentValueSource } from '@prisma/client';
import { IsBoolean } from 'class-validator';

export class RevalueUnvaluedAdjustmentsDto {
  /** Required on purpose: true only reports, false books the pairs. */
  @ApiProperty()
  @IsBoolean()
  dryRun!: boolean;
}

export class RevaluedAdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  originalTransactionId!: string;

  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;

  @ApiProperty()
  quantity!: string;

  @ApiProperty()
  unitCost!: string;

  @ApiProperty({
    enum: StockAdjustmentValueSource,
    enumName: 'StockAdjustmentValueSource',
  })
  valueSource!: StockAdjustmentValueSource;

  /** null in dry-run. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  reversalTransactionId!: string | null;

  /** null in dry-run. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  revaluedTransactionId!: string | null;
}

export class RevaluationGapDto {
  @ApiProperty({ format: 'uuid' })
  originalTransactionId!: string;

  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ format: 'uuid' })
  locationId!: string;
}

export class RevaluationReportDto {
  @ApiProperty()
  dryRun!: boolean;

  @ApiProperty()
  batchSize!: number;

  @ApiProperty({ type: [RevaluedAdjustmentDto] })
  revalued!: RevaluedAdjustmentDto[];

  @ApiProperty({ type: [RevaluationGapDto] })
  gaps!: RevaluationGapDto[];

  @ApiProperty({ type: [String] })
  alreadyRevalued!: string[];

  @ApiProperty({ type: [String] })
  alreadyReversed!: string[];
}

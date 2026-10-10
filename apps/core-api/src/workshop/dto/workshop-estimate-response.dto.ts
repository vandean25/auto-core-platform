import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkshopEstimateStatus, WorkshopLineItemType } from '@prisma/client';

export class WorkshopEstimateOverrunWarningDto {
  @ApiProperty()
  total_over_threshold!: boolean;

  @ApiProperty()
  new_work_lines!: boolean;

  @ApiProperty()
  approved_total_gross!: string;

  @ApiProperty()
  current_total_gross!: string;

  @ApiProperty()
  threshold_pct!: string;

  @ApiProperty()
  new_line_count!: number;
}

export class WorkshopEstimateVersionSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ enum: WorkshopEstimateStatus })
  status!: WorkshopEstimateStatus;

  @ApiProperty({ type: String, nullable: true })
  sent_at!: string | null;

  @ApiProperty({ type: String, nullable: true })
  valid_from!: string | null;

  @ApiProperty({ type: String, nullable: true })
  valid_until!: string | null;

  @ApiProperty({ type: String, nullable: true })
  total_net!: string | null;

  @ApiProperty({ type: String, nullable: true })
  total_tax!: string | null;

  @ApiProperty({ type: String, nullable: true })
  total_gross!: string | null;

  @ApiProperty({ type: String, nullable: true })
  snapshot_sha256!: string | null;

  @ApiProperty({ type: String, nullable: true })
  legal_text_version!: string | null;

  @ApiProperty({ type: String, nullable: true })
  retain_until!: string | null;

  @ApiProperty()
  legal_hold!: boolean;
}

export class WorkshopEstimateResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  workshop_order_id!: string;

  @ApiProperty()
  estimate_number!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ type: String })
  created_at!: string;

  @ApiProperty({ type: [WorkshopEstimateVersionSummaryDto] })
  versions!: WorkshopEstimateVersionSummaryDto[];

  @ApiProperty({ type: WorkshopEstimateOverrunWarningDto, nullable: true })
  overrun_warning!: WorkshopEstimateOverrunWarningDto | null;

  @ApiProperty({
    description:
      'False until CUSTOMER_ESTIMATE_SEND_ENABLED is on (legal copy approval pending). Sending is refused with 503 while false.',
  })
  send_enabled!: boolean;

  @ApiProperty({ type: String })
  overrun_threshold_pct!: string;
}

export class WorkshopEstimateListResponseDto {
  @ApiProperty({ type: [WorkshopEstimateResponseDto] })
  data!: WorkshopEstimateResponseDto[];
}

export class WorkshopEstimateDocumentDto {
  @ApiProperty({ enum: ['WORKSHOP_ESTIMATE'] })
  kind!: 'WORKSHOP_ESTIMATE';

  @ApiProperty()
  title!: string;

  @ApiProperty()
  estimate_number!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  issued_at!: string;

  @ApiProperty()
  valid_from!: string;

  @ApiProperty()
  valid_until!: string;

  @ApiProperty()
  validity_days!: number;

  @ApiProperty({ enum: [true] })
  non_binding!: true;

  @ApiProperty()
  free_of_charge!: boolean;

  @ApiProperty({ enum: ['GROSS', 'NET_WITH_VAT'] })
  price_display!: 'GROSS' | 'NET_WITH_VAT';
}

export class WorkshopEstimateLineDto {
  @ApiProperty()
  source_line_id!: string;

  @ApiProperty({ enum: WorkshopLineItemType })
  type!: WorkshopLineItemType;

  @ApiProperty()
  item_no!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  quantity!: string;

  @ApiProperty()
  unit_price!: string;

  @ApiProperty()
  tax_rate!: string;

  @ApiProperty()
  net!: string;

  @ApiProperty()
  tax!: string;

  @ApiProperty()
  gross!: string;
}

export class WorkshopEstimateTaxBucketDto {
  @ApiProperty()
  rate!: string;

  @ApiProperty()
  net!: string;

  @ApiProperty()
  tax!: string;

  @ApiProperty()
  gross!: string;
}

export class WorkshopEstimateTotalsDto {
  @ApiProperty()
  total_net!: string;

  @ApiProperty()
  total_tax!: string;

  @ApiProperty()
  total_gross!: string;

  @ApiProperty({ type: [WorkshopEstimateTaxBucketDto] })
  tax_breakdown!: WorkshopEstimateTaxBucketDto[];
}

export class WorkshopEstimateSnapshotDto {
  @ApiProperty()
  schema_version!: number;

  @ApiProperty({ type: WorkshopEstimateDocumentDto })
  document!: WorkshopEstimateDocumentDto;

  @ApiProperty({ type: 'object', additionalProperties: true })
  seller!: Record<string, string | null>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  customer!: Record<string, string | null>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  vehicle!: Record<string, string | number | null>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  order!: Record<string, string | number>;

  @ApiProperty({ type: [WorkshopEstimateLineDto] })
  lines!: WorkshopEstimateLineDto[];

  @ApiProperty({ type: WorkshopEstimateTotalsDto })
  totals!: WorkshopEstimateTotalsDto;

  @ApiProperty({ type: 'object', additionalProperties: true })
  branding!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: false })
  legal!: { text_version: string; text_sha256: string; paragraphs: string[] };
}

export class WorkshopEstimateDraftPreviewDto {
  @ApiProperty({ type: [WorkshopEstimateLineDto] })
  lines!: WorkshopEstimateLineDto[];

  @ApiProperty({ type: WorkshopEstimateTotalsDto })
  totals!: WorkshopEstimateTotalsDto;
}

export class WorkshopEstimateVersionDetailDto extends WorkshopEstimateVersionSummaryDto {
  @ApiProperty()
  estimate_id!: string;

  @ApiProperty()
  estimate_number!: string;

  @ApiProperty()
  workshop_order_id!: string;

  @ApiPropertyOptional({ type: WorkshopEstimateSnapshotDto, nullable: true })
  snapshot?: WorkshopEstimateSnapshotDto | null;

  @ApiPropertyOptional({
    type: WorkshopEstimateDraftPreviewDto,
    nullable: true,
  })
  draft_preview?: WorkshopEstimateDraftPreviewDto | null;
}

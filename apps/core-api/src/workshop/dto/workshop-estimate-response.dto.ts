import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID } from 'class-validator';
import {
  EstimateApprovalChannel,
  EstimateApprovalDecision,
  EstimateCustomerReaction,
  EstimateNotificationChannel,
  WorkshopEstimateStatus,
  WorkshopLineItemType,
} from '@prisma/client';

export class WorkshopEstimateCustomerSendBlockerDto {
  @ApiProperty({ enum: ['ZERO_UNIT_PRICE', 'CLAIMED_FITMENT'] })
  @IsIn(['ZERO_UNIT_PRICE', 'CLAIMED_FITMENT'])
  code!: 'ZERO_UNIT_PRICE' | 'CLAIMED_FITMENT';

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  source_line_id!: string;

  @ApiProperty()
  @IsString()
  item_no!: string;

  @ApiProperty()
  @IsString()
  description!: string;
}

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

  /** When the overrun was first seen against the approved baseline (AUT-355). */
  @ApiProperty({ type: String, format: 'date-time' })
  detected_at!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  notified_at!: string | null;

  @ApiProperty({ enum: EstimateNotificationChannel, nullable: true })
  notified_channel!: EstimateNotificationChannel | null;

  @ApiProperty({ type: String, nullable: true })
  notified_amount_gross!: string | null;

  @ApiProperty({ enum: EstimateCustomerReaction, nullable: true })
  customer_reaction!: EstimateCustomerReaction | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  /** True until the advisor has informed the customer about this overrun. */
  @ApiProperty()
  requires_customer_notice!: boolean;
}

/** A decision on a version, without IP address, user agent or typed name (AUT-355). */
export class WorkshopEstimateApprovalDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: EstimateApprovalChannel })
  channel!: EstimateApprovalChannel;

  @ApiProperty({ enum: EstimateApprovalDecision })
  decision!: EstimateApprovalDecision;

  @ApiProperty({ type: String, format: 'date-time' })
  decided_at!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Gross amount quoted with the decision.',
  })
  amount_quoted_gross!: string | null;

  @ApiProperty({ enum: EstimateCustomerReaction, nullable: true })
  customer_reaction!: EstimateCustomerReaction | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The user who recorded an advisor decision. Null for a customer link decision.',
  })
  recorded_by_user_id!: string | null;
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

  /** Set when the archive for this version exists. Null while no PDF has been rendered. */
  @ApiProperty({ type: String, nullable: true })
  pdf_generated_at!: string | null;

  /** Safe message of the last failed PDF render (no internal detail). Null when the last attempt succeeded or none ran. */
  @ApiProperty({ type: String, nullable: true })
  pdf_generation_error!: string | null;

  @ApiProperty({ type: WorkshopEstimateApprovalDto, nullable: true })
  approval!: WorkshopEstimateApprovalDto | null;
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

  @ApiProperty({
    type: [WorkshopEstimateCustomerSendBlockerDto],
    description:
      'Lines that block customer send until an advisor resolves zero price or claimed fitment.',
  })
  customer_send_blockers!: WorkshopEstimateCustomerSendBlockerDto[];
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

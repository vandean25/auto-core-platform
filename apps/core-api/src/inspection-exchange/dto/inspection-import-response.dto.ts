import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InspectionImportReviewedFieldsDto {
  @ApiProperty()
  outcome!: string;

  @ApiProperty()
  finality!: string;

  @ApiProperty()
  acknowledgement_state!: string;

  @ApiProperty()
  inspected_on!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  plate_valid_until!: string | null;

  @ApiProperty()
  source!: string;

  @ApiProperty()
  qualification_state!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  display_unconfirmed!: string | null;
}

export class InspectionImportPreviewResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  preview_expires_at!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  fingerprint!: string | null;

  @ApiProperty({ type: InspectionImportReviewedFieldsDto })
  reviewed_fields!: InspectionImportReviewedFieldsDto;
}

export class InspectionImportListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  native_result_reference!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  preview_fingerprint!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  semantic_digest!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  error_code!: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: Date;
}

export class ExternalInspectionResultSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  outcome!: string;

  @ApiProperty()
  finality!: string;

  @ApiProperty()
  acknowledgement_state!: string;

  @ApiProperty()
  inspected_on!: string;

  @ApiProperty()
  qualification_state!: string;
}

export class ApplyInspectionImportResponseDto {
  @ApiProperty({ type: ExternalInspectionResultSummaryDto })
  result!: ExternalInspectionResultSummaryDto;

  @ApiProperty()
  replay!: boolean;
}

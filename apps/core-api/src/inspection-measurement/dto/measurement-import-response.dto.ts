import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';

export class BrakeMeasurementWheelResponseDto {
  @ApiProperty()
  axle!: number;

  @ApiProperty()
  side!: string;

  @ApiProperty()
  force!: string;

  @ApiProperty()
  unit!: string;
}

export class MeasurementImportReviewedFieldsDto {
  @ApiProperty()
  measured_at!: string;

  @ApiProperty()
  finality!: string;

  @ApiProperty()
  test_kind!: string;

  @ApiProperty()
  device_serial!: string;

  @ApiProperty()
  session_ref!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  quarantine_reason!: string | null;

  @ApiProperty({ type: [BrakeMeasurementWheelResponseDto] })
  wheels!: BrakeMeasurementWheelResponseDto[];
}

export class MeasurementImportPreviewResponseDto {
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

  @ApiPropertyOptional({ type: String, nullable: true })
  error_code!: string | null;

  @ApiProperty({ type: MeasurementImportReviewedFieldsDto })
  reviewed_fields!: MeasurementImportReviewedFieldsDto;
}

export class AppliedMeasurementSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  measurement_id!: string;

  @ApiProperty()
  revision!: string;

  @ApiProperty()
  measured_at!: string;

  @ApiProperty()
  semantic_digest!: string;

  @ApiProperty({ type: [BrakeMeasurementWheelResponseDto] })
  wheels!: BrakeMeasurementWheelResponseDto[];
}

export class ApplyMeasurementImportResponseDto {
  @ApiProperty({ type: AppliedMeasurementSummaryDto })
  measurement!: AppliedMeasurementSummaryDto;

  @ApiProperty()
  replay!: boolean;
}

export class MeasurementImportListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  native_measurement_reference!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  preview_fingerprint!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  semantic_digest!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  quarantine_reason!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  error_code!: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ type: AppliedMeasurementSummaryDto, nullable: true })
  applied_measurement!: AppliedMeasurementSummaryDto | null;
}

export class MeasurementImportListResponseDto {
  @ApiProperty({ type: [MeasurementImportListItemDto] })
  data!: MeasurementImportListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

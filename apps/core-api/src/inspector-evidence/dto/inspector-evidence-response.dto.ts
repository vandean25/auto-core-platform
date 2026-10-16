import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InspectorEvidenceRevisionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employee_id!: string;

  @ApiProperty()
  site_id!: string;

  @ApiProperty()
  schema_version!: string;

  @ApiProperty()
  source_version!: string;

  @ApiProperty()
  station_ref!: string;

  @ApiProperty()
  evidence_review!: string;

  @ApiPropertyOptional()
  reviewed_at?: string | null;

  @ApiPropertyOptional()
  review_valid_until?: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  created_at!: string;

  @ApiPropertyOptional({
    description: 'Restricted document reference; management roles only',
  })
  document_ref?: string;
}

export class InspectorEvidenceListResponseDto {
  @ApiProperty({ type: [InspectorEvidenceRevisionResponseDto] })
  data!: InspectorEvidenceRevisionResponseDto[];

  @ApiProperty()
  meta!: {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
  };
}

export class InspectorEvidenceAssessmentResponseDto {
  @ApiProperty()
  evidence_review!: string;

  @ApiProperty()
  inspection_time_temporal_scope!: string;

  @ApiProperty()
  as_of_temporal_scope!: string;

  @ApiProperty()
  freshness!: string;

  @ApiProperty()
  qualification_support_status!: string;

  @ApiProperty({ enum: ['NOT_CONFIGURED'] })
  registry_adapter!: 'NOT_CONFIGURED';
}

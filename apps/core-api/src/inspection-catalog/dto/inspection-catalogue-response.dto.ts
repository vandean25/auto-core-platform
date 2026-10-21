import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class InspectionCataloguePreviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  manifest_reference!: string;

  @ApiProperty({ nullable: true, type: String })
  fingerprint!: string | null;

  @ApiProperty({ nullable: true, type: String })
  manifest_digest!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  preview_expires_at!: string | null;

  @ApiProperty({ nullable: true, type: String })
  error_code!: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  source_kind!: string;

  @ApiProperty()
  source_version!: string;

  @ApiProperty()
  coverage!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  recheck_after!: string | null;
}

export class ActivateInspectionCatalogueResponseDto {
  @ApiProperty({ format: 'uuid' })
  catalogue_version_id!: string;

  @ApiProperty()
  source_version!: string;

  @ApiProperty()
  source_kind!: string;

  @ApiProperty()
  coverage!: string;

  @ApiProperty({ type: Boolean })
  replay!: boolean;
}

export class CatalogueReferenceResolutionDto {
  @ApiProperty()
  position_id!: string;

  @ApiProperty({ nullable: true, type: String })
  entry_id!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  label!: string | null;

  @ApiProperty()
  source_kind!: string;

  @ApiProperty()
  coverage!: string;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  catalogue_version_id!: string | null;

  @ApiProperty({ nullable: true, type: String })
  source_version!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  recheck_after!: string | null;

  @ApiProperty({ type: Boolean })
  currentness_stale!: boolean;
}

export class CatalogueReferenceListResponseDto {
  @ApiProperty({ type: [CatalogueReferenceResolutionDto] })
  data!: CatalogueReferenceResolutionDto[];
}

export class CreateInspectionFindingReferenceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workshop_order_id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workshop_task_id!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  position_id!: string;

  @ApiProperty({ nullable: true, required: false, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entry_id?: string | null;

  @ApiProperty({ nullable: true, required: false, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  human_finding_label?: string | null;

  @ApiProperty({ nullable: true, required: false, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  vehicle_class?: string | null;
}

export class InspectionFindingProvenanceSnapshotDto {
  @ApiProperty()
  source_kind!: string;

  @ApiProperty()
  source_version!: string;

  @ApiProperty()
  source_uri!: string;

  @ApiProperty()
  coverage!: string;

  @ApiProperty()
  content_sha256!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  recheck_after!: string;
}

export class InspectionFindingReferenceListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  position_id!: string;

  @ApiProperty({ nullable: true, type: String })
  entry_id!: string | null;

  @ApiProperty()
  label_snapshot!: string;

  @ApiProperty()
  source_version!: string;

  @ApiProperty()
  source_kind!: string;

  @ApiProperty()
  coverage!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  recheck_after!: string;

  @ApiProperty({ type: InspectionFindingProvenanceSnapshotDto })
  provenance_snapshot!: InspectionFindingProvenanceSnapshotDto;

  @ApiProperty({ nullable: true, type: String })
  human_finding_label!: string | null;
}

export class InspectionFindingReferenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  position_id!: string;

  @ApiProperty({ nullable: true, type: String })
  entry_id!: string | null;

  @ApiProperty()
  label_snapshot!: string;

  @ApiProperty()
  source_version!: string;

  @ApiProperty()
  source_kind!: string;

  @ApiProperty()
  coverage!: string;
}

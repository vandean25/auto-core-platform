import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportEntityType, ImportJobStatus } from '@prisma/client';

export class ImportJobProgressDto {
  @ApiProperty({ enum: ['dry_run', 'apply'], nullable: true })
  phase!: 'dry_run' | 'apply' | null;

  @ApiProperty()
  processed_rows!: number;

  @ApiProperty()
  total_rows!: number;

  @ApiProperty({ nullable: true, type: Number })
  eta_seconds!: number | null;
}

export class ImportJobTotalsDto {
  @ApiProperty()
  rows!: number;

  @ApiProperty()
  create!: number;

  @ApiProperty()
  update!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  error!: number;

  @ApiPropertyOptional({ type: Number })
  flagged_jumps?: number;
}

export class ImportJobResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ImportEntityType, enumName: 'ImportEntityType' })
  entity_type!: ImportEntityType;

  @ApiProperty()
  source_system!: string;

  @ApiProperty()
  file_name!: string;

  @ApiProperty()
  file_sha256!: string;

  @ApiProperty({ enum: ImportJobStatus, enumName: 'ImportJobStatus' })
  status!: ImportJobStatus;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  mapping!: Record<string, string>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  options!: Record<string, unknown>;

  @ApiProperty({ type: ImportJobTotalsDto })
  totals!: ImportJobTotalsDto;

  @ApiPropertyOptional({ type: ImportJobProgressDto, nullable: true })
  progress?: ImportJobProgressDto | null;

  @ApiProperty({ nullable: true })
  created_by!: string | null;

  @ApiProperty()
  created_at!: string;

  @ApiProperty({ nullable: true })
  applied_at!: string | null;
}

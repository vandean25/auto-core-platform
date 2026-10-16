import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export class CreateInspectorEvidenceDto {
  @ApiProperty({ example: 'acp-inspector-evidence/1' })
  @IsString()
  @MaxLength(32)
  schema_version!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  source_version!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  issuer!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  source_person_ref!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  station_ref!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  assignment_ref!: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  assignment_from?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  assignment_until_exclusive?: string | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  vehicle_classes!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  weight_scope?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  brake_course_scope?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  training_completed_on?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  next_training_due_on?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  continuation_from?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  continuation_until_exclusive?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  effective_from?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(DATE_PATTERN)
  effective_until_exclusive?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  withdrawal_effective_at?: string | null;

  @ApiProperty({
    description: 'Authorized storage object reference (never a public URL)',
  })
  @IsString()
  @MaxLength(128)
  document_ref!: string;

  @ApiProperty({
    description: 'SHA-256 hex digest of restricted document bytes',
  })
  @IsString()
  @Length(64, 64)
  @Matches(DIGEST_PATTERN)
  document_digest!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  provenance!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  predecessor_revision_id?: string | null;
}

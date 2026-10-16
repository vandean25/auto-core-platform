import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export enum InspectorEvidenceReviewDecision {
  ACCEPT = 'ACCEPT',
  SOURCE_CONFLICT = 'SOURCE_CONFLICT',
}

export class ReviewInspectorEvidenceDto {
  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(DIGEST_PATTERN)
  document_digest!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ enum: InspectorEvidenceReviewDecision })
  @IsEnum(InspectorEvidenceReviewDecision)
  decision!: InspectorEvidenceReviewDecision;

  @ApiProperty({ description: 'Source review freshness bound (max ~30 days)' })
  @IsISO8601()
  review_valid_until!: string;
}

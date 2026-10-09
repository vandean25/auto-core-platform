import { ApiProperty } from '@nestjs/swagger';
import { DECISION_SHADOW_USE_CASES } from '../decision-shadow-log.types.js';

export class DecisionShadowSuggestionDto {
  @ApiProperty({
    description: 'Choice suggested by the shadow provider. Never applied.',
  })
  choice!: string;

  @ApiProperty({ type: Number, nullable: true })
  confidence!: number | null;

  @ApiProperty({ type: String, nullable: true })
  rationale!: string | null;
}

export class DecisionShadowActualOutcomeDto {
  @ApiProperty({
    description: 'Deterministic outcome the suggestion is compared against',
  })
  choice!: string;

  @ApiProperty({ type: String, nullable: true })
  source!: string | null;
}

export class DecisionShadowLogResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'uuid' })
  traceId!: string;

  @ApiProperty({ enum: DECISION_SHADOW_USE_CASES })
  useCase!: string;

  @ApiProperty({ type: () => DecisionShadowSuggestionDto, nullable: true })
  suggestion!: DecisionShadowSuggestionDto | null;

  @ApiProperty({ type: () => DecisionShadowActualOutcomeDto, nullable: true })
  actualOutcome!: DecisionShadowActualOutcomeDto | null;

  @ApiProperty({ type: Number, nullable: true })
  latencyMs!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Provider error message. Null when the provider call succeeded.',
  })
  error!: string | null;

  @ApiProperty()
  provider!: string;

  @ApiProperty({ type: String, nullable: true })
  model!: string | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Whether the suggested choice equals the actual outcome. Null when there is no suggestion.',
  })
  match!: boolean | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class DecisionShadowLogListResponseDto {
  @ApiProperty({ type: [DecisionShadowLogResponseDto] })
  data!: DecisionShadowLogResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor for the next page when more results exist',
  })
  nextCursor!: string | null;
}

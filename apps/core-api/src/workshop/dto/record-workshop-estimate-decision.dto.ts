import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstimateCustomerReaction } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export const WORKSHOP_ESTIMATE_DECISIONS = ['APPROVED', 'DECLINED'] as const;
export const WORKSHOP_ADVISOR_DECISION_CHANNELS = [
  'PHONE',
  'IN_PERSON',
  'EMAIL',
] as const;
export const WORKSHOP_CUSTOMER_REACTIONS: readonly string[] = Object.values(
  EstimateCustomerReaction,
);

/** Gross amount as shown on the estimate, with cents. Up to Decimal(10,2). */
export const WORKSHOP_AMOUNT_PATTERN = /^\d{1,8}\.\d{2}$/;

/** Advisor-recorded decision on a sent estimate version (AUT-355, ADR-0025 §5 and §7). */
export class RecordWorkshopEstimateDecisionDto {
  @ApiProperty({ enum: WORKSHOP_ESTIMATE_DECISIONS })
  @IsIn(WORKSHOP_ESTIMATE_DECISIONS)
  decision!: (typeof WORKSHOP_ESTIMATE_DECISIONS)[number];

  @ApiProperty({
    enum: WORKSHOP_ADVISOR_DECISION_CHANNELS,
    description:
      'How the customer answered the workshop. The customer link is not a channel here.',
  })
  @IsIn(WORKSHOP_ADVISOR_DECISION_CHANNELS)
  channel!: (typeof WORKSHOP_ADVISOR_DECISION_CHANNELS)[number];

  @ApiProperty({
    example: '192.00',
    description:
      'Gross amount the customer was quoted. It must equal the gross total of the sent version.',
  })
  @Matches(WORKSHOP_AMOUNT_PATTERN)
  amount_quoted_gross!: string;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  note!: string;

  @ApiPropertyOptional({ enum: EstimateCustomerReaction })
  @IsOptional()
  @IsIn(WORKSHOP_CUSTOMER_REACTIONS)
  customer_reaction?: EstimateCustomerReaction;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'When the customer decided, for example the time of the call. Defaults to now. Must lie between sending and now.',
  })
  @IsOptional()
  @IsISO8601()
  decided_at?: string;
}

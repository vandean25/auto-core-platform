import { ApiProperty } from '@nestjs/swagger';
import { EstimateCustomerReaction } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, Matches } from 'class-validator';
import {
  WORKSHOP_ADVISOR_DECISION_CHANNELS,
  WORKSHOP_AMOUNT_PATTERN,
  WORKSHOP_CUSTOMER_REACTIONS,
} from './record-workshop-estimate-decision.dto.js';

/** The advisor's latest notice to the customer about an overrun. A later notice replaces it when the total has moved (AUT-355). */
export class RecordWorkshopOverrunNoticeDto {
  @ApiProperty({
    enum: WORKSHOP_ADVISOR_DECISION_CHANNELS,
    description: 'How the advisor informed the customer.',
  })
  @IsIn(WORKSHOP_ADVISOR_DECISION_CHANNELS)
  channel!: (typeof WORKSHOP_ADVISOR_DECISION_CHANNELS)[number];

  @ApiProperty({
    example: '240.00',
    description:
      'Gross amount quoted to the customer. It must equal the current gross total of the order.',
  })
  @Matches(WORKSHOP_AMOUNT_PATTERN)
  amount_quoted_gross!: string;

  @ApiProperty({ enum: EstimateCustomerReaction })
  @IsIn(WORKSHOP_CUSTOMER_REACTIONS)
  customer_reaction!: EstimateCustomerReaction;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 500)
  note!: string;
}

/** The recorded notice, as the order timeline shows it. */
export class WorkshopOverrunNoticeDto {
  @ApiProperty({
    description: 'Id of the overrun record that holds the notice.',
  })
  id!: string;

  @ApiProperty({
    type: Number,
    description: 'Version of the approved baseline.',
  })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  notified_at!: string;

  @ApiProperty({ enum: WORKSHOP_ADVISOR_DECISION_CHANNELS })
  channel!: (typeof WORKSHOP_ADVISOR_DECISION_CHANNELS)[number];

  @ApiProperty()
  amount_quoted_gross!: string;

  @ApiProperty({ enum: EstimateCustomerReaction })
  customer_reaction!: EstimateCustomerReaction;

  @ApiProperty()
  note!: string;
}

import { ApiProperty } from '@nestjs/swagger';

export const WORKSHOP_COMMUNICATION_KINDS = [
  'ESTIMATE_EMAIL',
  'ESTIMATE_APPROVAL',
  'OVERRUN_NOTIFICATION',
] as const;
export type WorkshopCommunicationKind =
  (typeof WORKSHOP_COMMUNICATION_KINDS)[number];

export const WORKSHOP_COMMUNICATION_CHANNELS = [
  'EMAIL',
  'LINK',
  'ADVISOR_RECORDED',
  'PHONE',
  'IN_PERSON',
] as const;
export type WorkshopCommunicationChannel =
  (typeof WORKSHOP_COMMUNICATION_CHANNELS)[number];

/** What the customer-facing timeline shows for an estimate email. PENDING and SENDING both read as QUEUED. */
export const WORKSHOP_COMMUNICATION_STATUSES = [
  'QUEUED',
  'SENT',
  'FAILED',
  'SUPPRESSED',
] as const;
export type WorkshopCommunicationStatus =
  (typeof WORKSHOP_COMMUNICATION_STATUSES)[number];

export const WORKSHOP_COMMUNICATION_DECISIONS = [
  'APPROVED',
  'DECLINED',
] as const;
export type WorkshopCommunicationDecision =
  (typeof WORKSHOP_COMMUNICATION_DECISIONS)[number];

export class WorkshopOrderCommunicationDto {
  @ApiProperty({
    description:
      'Outbox row id for an estimate email, approval id for a customer decision, overrun record id for an overrun notice.',
  })
  id!: string;

  @ApiProperty({ enum: WORKSHOP_COMMUNICATION_KINDS })
  kind!: WorkshopCommunicationKind;

  @ApiProperty({ enum: WORKSHOP_COMMUNICATION_CHANNELS })
  channel!: WorkshopCommunicationChannel;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Estimate version the entry is about.',
  })
  version!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurred_at!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: WORKSHOP_COMMUNICATION_STATUSES,
    description: 'Delivery state. Set for an estimate email only.',
  })
  status!: WorkshopCommunicationStatus | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: WORKSHOP_COMMUNICATION_DECISIONS,
    description: 'The customer decision. Set for an approval only.',
  })
  decision!: WorkshopCommunicationDecision | null;
}

export class WorkshopOrderCommunicationsResponseDto {
  @ApiProperty({ type: [WorkshopOrderCommunicationDto] })
  data!: WorkshopOrderCommunicationDto[];
}

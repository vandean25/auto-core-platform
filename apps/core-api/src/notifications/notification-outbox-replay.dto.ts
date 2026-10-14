import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

/** Rows one replay request may carry. A larger backlog is replayed in several requests. */
export const NOTIFICATION_REPLAY_MAX_IDS = 50;

/** Why a row was not replayed. A refused row is never sent again by this request. */
export const NOTIFICATION_REPLAY_REFUSAL_CODES = [
  'NOT_FOUND',
  'NOT_FAILED',
  'BODY_PURGED',
  'BODY_MISSING',
  'LINK_REDACTED',
  'STALE_UNSENT',
] as const;

export type NotificationReplayRefusalCode =
  (typeof NOTIFICATION_REPLAY_REFUSAL_CODES)[number];

export class NotificationOutboxReplayRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: NOTIFICATION_REPLAY_MAX_IDS,
    uniqueItems: true,
    description: 'Outbox row ids in FAILED status to send again.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NOTIFICATION_REPLAY_MAX_IDS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}

export class NotificationOutboxReplayRefusalDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: NOTIFICATION_REPLAY_REFUSAL_CODES })
  code!: NotificationReplayRefusalCode;
}

export class NotificationOutboxReplayResponseDto {
  @ApiProperty({
    type: [String],
    description:
      'Rows that went back to PENDING. A wake-up that could not be queued is logged, and the recovery sweep wakes the row later.',
  })
  replayed!: string[];

  @ApiProperty({ type: [NotificationOutboxReplayRefusalDto] })
  refused!: NotificationOutboxReplayRefusalDto[];
}

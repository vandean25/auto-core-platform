import { ApiProperty } from '@nestjs/swagger';
import { READY_EMAIL_NOTICE_CODES } from '../workshop-order-ready-notice.js';

export class WorkshopReadyEmailNoticeDto {
  @ApiProperty({ enum: READY_EMAIL_NOTICE_CODES })
  code!: (typeof READY_EMAIL_NOTICE_CODES)[number];

  @ApiProperty({
    description:
      'Human-readable reason for advisors when the ready notice is blocked, queued, sent or failed.',
  })
  message!: string;
}

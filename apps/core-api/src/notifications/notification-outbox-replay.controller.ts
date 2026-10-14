import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  NotificationOutboxReplayRequestDto,
  NotificationOutboxReplayResponseDto,
} from './notification-outbox-replay.dto.js';
import { NotificationOutboxReplayService } from './notification-outbox-replay.service.js';

/**
 * Admin replay of dead-lettered notifications (ADR-0025 §6). Not public: the session guard authenticates the
 * caller, and the service admits only an owner or an admin.
 */
@ApiTags('notifications')
@Controller('notifications/outbox')
export class NotificationOutboxReplayController {
  constructor(private readonly replay: NotificationOutboxReplayService) {}

  @Post('replay')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: NotificationOutboxReplayResponseDto })
  replayFailed(
    @Body() body: NotificationOutboxReplayRequestDto,
  ): Promise<NotificationOutboxReplayResponseDto> {
    return this.replay.replay(body.ids);
  }
}

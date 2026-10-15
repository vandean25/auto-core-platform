import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DomainEventFeedAuthorization } from './domain-event-feed.authorization.js';
import { DomainEventFeedService } from './domain-event-feed.service.js';
import { DomainEventFeedListResponseDto } from './dto/domain-event-feed-response.dto.js';
import { QueryDomainEventsDto } from './dto/query-domain-events.dto.js';

@ApiTags('Agent domain events')
@Controller('agent/domain-events')
export class DomainEventFeedController {
  constructor(
    private readonly feed: DomainEventFeedService,
    private readonly authorization: DomainEventFeedAuthorization,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List committed domain events (OWNER/ADMIN)',
    description:
      'Read-only, resumable feed ordered by monotonic sequence. Only sites the caller is authorized for are returned.',
  })
  @ApiOkResponse({ type: DomainEventFeedListResponseDto })
  list(
    @Query() query: QueryDomainEventsDto,
  ): Promise<DomainEventFeedListResponseDto> {
    this.authorization.assertSupervisorOrAdmin();
    return this.feed.listFeed({
      cursor: query.cursor,
      pageSize: query.pageSize,
      eventType: query.eventType,
    });
  }
}

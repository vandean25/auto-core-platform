import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicEstimateApprovalHeadersInterceptor } from './public-estimate-approval.headers.interceptor.js';
import { ESTIMATE_APPROVAL_IP_THROTTLER } from './public-estimate-approval.constants.js';
import { PublicEstimateDecisionDto } from './public-estimate-approval.dto.js';
import {
  PublicEstimateApprovalService,
  type PublicApprovalRequestMeta,
  type PublicEstimateDecisionResult,
} from './public-estimate-approval.service.js';
import type { PublicEstimateView } from './public-estimate-approval.projection.js';

function requestMetaOf(request: Request): PublicApprovalRequestMeta {
  return {
    ip: request.ip ?? null,
    userAgent: headerValue(request.headers['user-agent']),
    acceptLanguage: headerValue(request.headers['accept-language']),
  };
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

/**
 * The unauthenticated approval route for a sent estimate (ADR-0025 §7, AUT-373). The token in the path is the
 * only credential. The route is marked @Public so the session guard skips it, and it is not an API-key route.
 */
@ApiTags('public-estimate-approvals')
@UseInterceptors(PublicEstimateApprovalHeadersInterceptor)
@Controller('public/estimate-approvals')
export class PublicEstimateApprovalController {
  constructor(private readonly approvals: PublicEstimateApprovalService) {}

  @Public()
  @Get(':token')
  @Throttle({ [ESTIMATE_APPROVAL_IP_THROTTLER]: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Read a sent estimate by its approval link',
    description:
      'Repeatable and read-only. It never consumes the token. Answers only while the estimate can still be decided.',
  })
  @ApiOkResponse({ description: 'The estimate document fields to show.' })
  @ApiNotFoundResponse({ description: 'The link is not valid.' })
  @ApiGoneResponse({ description: 'The link has expired or was used.' })
  @ApiConflictResponse({
    description: 'The estimate can no longer be decided.',
  })
  @ApiTooManyRequestsResponse({ description: 'Too many requests.' })
  read(@Param('token') token: string): Promise<PublicEstimateView> {
    return this.approvals.read(token);
  }

  @Public()
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ [ESTIMATE_APPROVAL_IP_THROTTLER]: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Approve or decline a sent estimate by its approval link',
    description:
      'Consumes the token and records the decision with its evidence. Approval needs the legal confirmations and the typed name.',
  })
  @ApiOkResponse({ description: 'The decision that was recorded.' })
  @ApiNotFoundResponse({ description: 'The link is not valid.' })
  @ApiGoneResponse({ description: 'The link has expired or was used.' })
  @ApiConflictResponse({
    description: 'The estimate can no longer be decided.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The confirmations for an approval are missing.',
  })
  @ApiTooManyRequestsResponse({ description: 'Too many requests.' })
  decide(
    @Param('token') token: string,
    @Body() body: PublicEstimateDecisionDto,
    @Req() request: Request,
  ): Promise<PublicEstimateDecisionResult> {
    return this.approvals.decide(token, body, requestMetaOf(request));
  }
}

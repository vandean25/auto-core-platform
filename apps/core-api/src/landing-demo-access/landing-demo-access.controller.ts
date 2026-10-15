import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import {
  LandingDemoAccessOkDto,
  LandingDemoAccessRequestDto,
} from './landing-demo-access.dto.js';
import { LANDING_DEMO_IP_THROTTLER } from './landing-demo-access.constants.js';
import { LandingDemoAccessService } from './landing-demo-access.service.js';

@ApiTags('public-landing-demo')
@Controller('public/landing-demo/access')
export class LandingDemoAccessController {
  constructor(private readonly landingDemo: LandingDemoAccessService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ [LANDING_DEMO_IP_THROTTLER]: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request self-service demo access (landing page form)',
    description:
      'Creates or refreshes a demo user in the landing demo tenant and emails a one-time magic sign-in link. Always returns {ok:true} for honeypot submissions.',
  })
  @ApiOkResponse({ type: LandingDemoAccessOkDto })
  @ApiUnprocessableEntityResponse({
    description: 'Validation or captcha failed.',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
  submit(
    @Body() body: LandingDemoAccessRequestDto,
    @Req() request: Request,
  ): Promise<LandingDemoAccessOkDto> {
    return this.landingDemo.submit(body, {
      ip: request.ip ?? null,
    });
  }
}

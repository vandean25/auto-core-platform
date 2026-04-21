import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOkResponse({
    schema: { type: 'string' },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('/debug-sentry')
  @ApiOkResponse({
    schema: { type: 'string' },
  })
  getSentryError(): never {
    if (process.env.ENABLE_SENTRY_DEBUG_ROUTE !== 'true') {
      throw new NotFoundException();
    }

    throw new Error('My first Sentry error!');
  }
}

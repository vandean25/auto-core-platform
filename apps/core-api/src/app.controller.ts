import { Controller, Get, NotFoundException } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('/debug-sentry')
  getSentryError(): never {
    if (process.env.ENABLE_SENTRY_DEBUG_ROUTE !== 'true') {
      throw new NotFoundException();
    }

    throw new Error('My first Sentry error!');
  }
}

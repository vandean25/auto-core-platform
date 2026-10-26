import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CronInvokerOidcGuard } from '../common/guards/cron-invoker-oidc.guard.js';
import { CoreApiCronJobRegistryService } from './core-api-cron-job-registry.service.js';
import { HttpCronModeGuard } from './http-cron-mode.guard.js';

@Controller('internal/cron')
@Public()
@UseGuards(HttpCronModeGuard, CronInvokerOidcGuard)
export class InternalCronController {
  private readonly logger = new Logger(InternalCronController.name);

  constructor(private readonly registry: CoreApiCronJobRegistryService) {}

  @Post(':jobName')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async invoke(
    @Param('jobName') jobName: string,
  ): Promise<{ status: 'ran' | 'skipped' }> {
    if (!this.registry.isKnownJobName(jobName)) {
      throw new NotFoundException();
    }

    this.logger.log(`HTTP cron invoke started: ${jobName}`);
    try {
      const ran = await this.registry.run(jobName);
      this.logger.log(
        `HTTP cron invoke finished: ${jobName} (${ran ? 'ran' : 'skipped'})`,
      );
      return { status: ran ? 'ran' : 'skipped' };
    } catch (error) {
      this.logger.error(
        `HTTP cron job "${jobName}" failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      throw error;
    }
  }
}

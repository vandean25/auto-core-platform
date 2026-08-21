import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
      },
      required: ['status'],
    },
  })
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

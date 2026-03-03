import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { LaborService } from './labor.service';

@Controller('labor')
export class LaborController {
  constructor(private readonly laborService: LaborService) {}

  @Get('search')
  @ApiQuery({ name: 'q', required: true, schema: { type: 'string' } })
  @ApiQuery({
    name: 'workshopOrderId',
    required: true,
    schema: { type: 'string' },
  })
  search(
    @Query('q') query: string,
    @Query('workshopOrderId') workshopOrderId: string,
  ) {
    return this.laborService.search(query, workshopOrderId);
  }
}

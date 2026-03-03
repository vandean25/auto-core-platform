import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

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
    return this.catalogService.search(query, workshopOrderId);
  }
}

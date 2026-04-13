import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { CatalogSearchResponseDto } from './dto/catalog-search.dto';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('search')
  @ApiOkResponse({ type: CatalogSearchResponseDto })
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

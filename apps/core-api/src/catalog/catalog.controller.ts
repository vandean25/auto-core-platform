import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiConflictResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { CatalogExternalService } from './catalog-external.service';
import { CatalogSearchResponseDto } from './dto/catalog-search.dto';
import {
  CatalogAssemblyGroupsResponseDto,
  CatalogExternalLaborItemDto,
  CatalogExternalPartsItemDto,
  CatalogExternalSearchResponseDto,
} from './dto/catalog-external-search.dto';
import {
  CatalogAssemblyGroupsQueryDto,
  CatalogExternalSearchQueryDto,
} from './dto/catalog-external-search-query.dto';

@ApiTags('catalog')
@ApiExtraModels(CatalogExternalPartsItemDto, CatalogExternalLaborItemDto)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly catalogExternalService: CatalogExternalService,
  ) {}

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

  @Get('external/search')
  @ApiOkResponse({ type: CatalogExternalSearchResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiConflictResponse({ description: 'Workshop context conflict' })
  externalSearch(@Query() query: CatalogExternalSearchQueryDto) {
    return this.catalogExternalService.search(query);
  }

  @Get('external/assembly-groups')
  @ApiOkResponse({ type: CatalogAssemblyGroupsResponseDto })
  externalAssemblyGroups(@Query() query: CatalogAssemblyGroupsQueryDto) {
    return this.catalogExternalService.listAssemblyGroups(query);
  }
}

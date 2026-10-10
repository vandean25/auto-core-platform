import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import {
  ApiExtension,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../common/dto/paginated-response.dto.js';
import { ApiKeyRequestAuditInterceptor } from '../api-keys/api-key-request-audit.interceptor.js';
import { RequirePublicApiScope } from '../decorators/require-public-api-scope.decorator.js';
import { PUBLIC_API_KEY_SCHEME } from '../public-api.constants.js';
import {
  PublicListQueryDto,
  PublicStockLevelDto,
} from './dto/public-api-read.dto.js';
import { PublicApiReadService } from './public-api-read.service.js';

@ApiTags('public-api')
@ApiSecurity(PUBLIC_API_KEY_SCHEME)
@UseInterceptors(ApiKeyRequestAuditInterceptor)
@Controller('public/v1/stock')
export class PublicStockController {
  constructor(private readonly publicApiRead: PublicApiReadService) {}

  @Get()
  @RequirePublicApiScope('stock:read')
  @ApiExtension('x-required-scopes', ['stock:read'])
  @ApiOperation({
    summary: 'List parts stock levels per storage location (active sites)',
    description:
      'Parts inventory only. Dealer vehicle stock is not part of this scope.',
  })
  @ApiPaginatedResponse(PublicStockLevelDto)
  list(@Query() query: PublicListQueryDto) {
    return this.publicApiRead.listStockLevels(query);
  }
}

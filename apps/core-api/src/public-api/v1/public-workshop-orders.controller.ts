import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiExtension,
  ApiNotFoundResponse,
  ApiOkResponse,
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
  PublicWorkshopOrderDto,
} from './dto/public-api-read.dto.js';
import { PublicApiReadService } from './public-api-read.service.js';

@ApiTags('public-api')
@ApiSecurity(PUBLIC_API_KEY_SCHEME)
@UseInterceptors(ApiKeyRequestAuditInterceptor)
@Controller('public/v1/workshop-orders')
export class PublicWorkshopOrdersController {
  constructor(private readonly publicApiRead: PublicApiReadService) {}

  @Get()
  @RequirePublicApiScope('workshop-orders:read')
  @ApiExtension('x-required-scopes', ['workshop-orders:read'])
  @ApiOperation({
    summary: 'List workshop orders of the key tenant (active sites)',
  })
  @ApiPaginatedResponse(PublicWorkshopOrderDto)
  list(@Query() query: PublicListQueryDto) {
    return this.publicApiRead.listWorkshopOrders(query);
  }

  @Get(':id')
  @RequirePublicApiScope('workshop-orders:read')
  @ApiExtension('x-required-scopes', ['workshop-orders:read'])
  @ApiOperation({
    summary: 'Get one workshop order of the key tenant (active sites)',
  })
  @ApiOkResponse({ type: PublicWorkshopOrderDto })
  @ApiNotFoundResponse({
    description: 'Not found in the key tenant or active sites.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApiRead.getWorkshopOrder(id);
  }
}

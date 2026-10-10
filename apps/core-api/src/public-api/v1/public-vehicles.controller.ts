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
  PublicVehicleDto,
} from './dto/public-api-read.dto.js';
import { PublicApiReadService } from './public-api-read.service.js';

@ApiTags('public-api')
@ApiSecurity(PUBLIC_API_KEY_SCHEME)
@UseInterceptors(ApiKeyRequestAuditInterceptor)
@Controller('public/v1/vehicles')
export class PublicVehiclesController {
  constructor(private readonly publicApiRead: PublicApiReadService) {}

  @Get()
  @RequirePublicApiScope('vehicles:read')
  @ApiExtension('x-required-scopes', ['vehicles:read'])
  @ApiOperation({
    summary: 'List vehicle identities of the key tenant',
    description:
      'Identity fields only. Dealer-stock lot, status and cost fields are never returned.',
  })
  @ApiPaginatedResponse(PublicVehicleDto)
  list(@Query() query: PublicListQueryDto) {
    return this.publicApiRead.listVehicles(query);
  }

  @Get(':id')
  @RequirePublicApiScope('vehicles:read')
  @ApiExtension('x-required-scopes', ['vehicles:read'])
  @ApiOperation({ summary: 'Get one vehicle identity of the key tenant' })
  @ApiOkResponse({ type: PublicVehicleDto })
  @ApiNotFoundResponse({ description: 'Not found in the key tenant.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApiRead.getVehicle(id);
  }
}

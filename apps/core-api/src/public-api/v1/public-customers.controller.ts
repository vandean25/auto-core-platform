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
  PublicCustomerDto,
  PublicListQueryDto,
} from './dto/public-api-read.dto.js';
import { PublicApiReadService } from './public-api-read.service.js';

@ApiTags('public-api')
@ApiSecurity(PUBLIC_API_KEY_SCHEME)
@UseInterceptors(ApiKeyRequestAuditInterceptor)
@Controller('public/v1/customers')
export class PublicCustomersController {
  constructor(private readonly publicApiRead: PublicApiReadService) {}

  @Get()
  @RequirePublicApiScope('customers:read')
  @ApiExtension('x-required-scopes', ['customers:read'])
  @ApiOperation({ summary: 'List customers of the key tenant' })
  @ApiPaginatedResponse(PublicCustomerDto)
  list(@Query() query: PublicListQueryDto) {
    return this.publicApiRead.listCustomers(query);
  }

  @Get(':id')
  @RequirePublicApiScope('customers:read')
  @ApiExtension('x-required-scopes', ['customers:read'])
  @ApiOperation({ summary: 'Get one customer of the key tenant' })
  @ApiOkResponse({ type: PublicCustomerDto })
  @ApiNotFoundResponse({ description: 'Not found in the key tenant.' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApiRead.getCustomer(id);
  }
}

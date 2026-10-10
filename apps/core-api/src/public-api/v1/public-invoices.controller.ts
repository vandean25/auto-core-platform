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
  PublicInvoiceDto,
  PublicListQueryDto,
} from './dto/public-api-read.dto.js';
import { PublicApiReadService } from './public-api-read.service.js';

@ApiTags('public-api')
@ApiSecurity(PUBLIC_API_KEY_SCHEME)
@UseInterceptors(ApiKeyRequestAuditInterceptor)
@Controller('public/v1/invoices')
export class PublicInvoicesController {
  constructor(private readonly publicApiRead: PublicApiReadService) {}

  @Get()
  @RequirePublicApiScope('invoices:read')
  @ApiExtension('x-required-scopes', ['invoices:read'])
  @ApiOperation({ summary: 'List invoice headers of the key tenant' })
  @ApiPaginatedResponse(PublicInvoiceDto)
  list(@Query() query: PublicListQueryDto) {
    return this.publicApiRead.listInvoices(query);
  }

  @Get(':id')
  @RequirePublicApiScope('invoices:read')
  @ApiExtension('x-required-scopes', ['invoices:read'])
  @ApiOperation({ summary: 'Get one invoice header of the key tenant' })
  @ApiOkResponse({ type: PublicInvoiceDto })
  @ApiNotFoundResponse({
    description: 'Not found in the key tenant or active sites.',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicApiRead.getInvoice(id);
  }
}

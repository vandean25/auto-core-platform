import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { AuditService } from './audit.service.js';
import { AuditLogListResponseDto, QueryAuditLogsDto } from './dto/index.js';

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List tenant audit logs',
    description:
      'Returns a paginated list of immutable business mutation and deletion audit records for the authenticated tenant.',
  })
  @ApiOkResponse({
    type: AuditLogListResponseDto,
    description: 'Paginated list of audit log entries',
  })
  findAll(@Query() query: QueryAuditLogsDto): Promise<AuditLogListResponseDto> {
    assertTenantAdmin(this.tenantContext);
    return this.auditService.findAll(query);
  }
}

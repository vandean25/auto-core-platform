import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditLogListResponseDto, QueryAuditLogsDto } from './dto';

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

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
    return this.auditService.findAll(query);
  }
}

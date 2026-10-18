import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { assertTyreStorageRead } from './tyre-storage-access.js';
import { toTyreSetListRowDto } from './tyre-set-list.mapper.js';
import { queryTyreSetsForList } from './tyre-set-list.read.js';
import type { TyreSetListQuery } from './tyre-set-list.query.js';

/** MCP and offset-paged tyre-set reads without changing {@link TyreStorageService#list}. */
@Injectable()
export class TyreSetListReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async list(query: TyreSetListQuery) {
    assertTyreStorageRead(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return queryTyreSetsForList(
      this.prisma,
      tenantId,
      siteId,
      query,
      toTyreSetListRowDto,
    );
  }
}

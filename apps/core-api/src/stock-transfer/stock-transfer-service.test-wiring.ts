import type { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import type { LedgerService } from '../inventory/ledger.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { StockTransferAccessService } from './stock-transfer-access.service.js';
import { StockTransferCommandService } from './stock-transfer-command.service.js';
import { StockTransferCommitService } from './stock-transfer-commit.service.js';
import { StockTransferLedgerPostingService } from './stock-transfer-ledger-posting.service.js';
import { StockTransferMutationService } from './stock-transfer-mutation.service.js';
import { StockTransferQueryService } from './stock-transfer-query.service.js';
import { StockTransferSiteLockService } from './stock-transfer-site-lock.service.js';

/** Unit-test wiring that mirrors the pre-split StockTransferService constructor. */
export function wireStockTransferServiceForUnitTest(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  ledgerService: LedgerService,
  realtimeService: DashboardRealtimeService,
): {
  queryService: StockTransferQueryService;
  mutationService: StockTransferMutationService;
} {
  const accessService = new StockTransferAccessService(prisma, tenantContext);
  const queryService = new StockTransferQueryService(prisma, accessService);
  const siteLockService = new StockTransferSiteLockService();
  const ledgerPostingService = new StockTransferLedgerPostingService(
    ledgerService,
  );
  const commandService = new StockTransferCommandService(
    prisma,
    accessService,
    queryService,
  );
  const commitService = new StockTransferCommitService(
    prisma,
    tenantContext,
    realtimeService,
  );
  const mutationService = new StockTransferMutationService(
    accessService,
    queryService,
    siteLockService,
    ledgerPostingService,
    commandService,
    commitService,
  );
  return { queryService, mutationService };
}

import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { TyreSetListReadService } from '../tyre-storage/tyre-set-list-read.service.js';
import type { TyreStorageService } from '../tyre-storage/tyre-storage.service.js';
import type { GewaehrleistungDueListReadService } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-due-list.read.js';
import type { WarrantyClaimSiteListService } from '../warranty-claim/warranty-claim-site-list.service.js';
import { McpComplianceReadListsService } from './mcp-compliance-read-lists.service.js';
import { encodeMcpCursor } from './mcp-output.util.js';

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const VEHICLE_ID = '00000000-0000-4000-8000-0000000000v1';

function buildLists(options: { role?: string } = {}) {
  const tenantContext = {
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: options.role ?? 'SALES',
    }),
  };
  const gewaehrleistungDueList = {
    list: jest.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, pageSize: 0, pageCount: 0 },
    }),
  };
  const tyreStorage = {
    listDueForSwap: jest.fn().mockResolvedValue({ data: [] }),
  };
  const tyreSetListRead = {
    list: jest.fn().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, pageSize: 10, pageCount: 0 },
    }),
  };
  const warrantyClaimSiteList = {
    listAtActiveSite: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
  };

  const service = new McpComplianceReadListsService(
    tenantContext as unknown as TenantContextService,
    gewaehrleistungDueList as unknown as GewaehrleistungDueListReadService,
    tyreStorage as unknown as TyreStorageService,
    tyreSetListRead as unknown as TyreSetListReadService,
    warrantyClaimSiteList as unknown as WarrantyClaimSiteListService,
  );

  return {
    service,
    gewaehrleistungDueList,
    tyreStorage,
    tyreSetListRead,
    warrantyClaimSiteList,
  };
}

describe('McpComplianceReadListsService', () => {
  it('passes vehicle_id to list when customer_id is also set', async () => {
    const { service, tyreSetListRead } = buildLists();
    await service.listTyreSets({
      customer_id: CUSTOMER_ID,
      vehicle_id: VEHICLE_ID,
      pageSize: 10,
    });
    expect(tyreSetListRead.list).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        vehicleId: VEHICLE_ID,
      }),
    );
  });

  it('pages with a row offset cursor instead of a page index', async () => {
    const { service, tyreSetListRead } = buildLists();
    tyreSetListRead.list.mockResolvedValueOnce({
      data: [{ id: 'row-2' }, { id: 'row-3' }, { id: 'row-4' }],
      meta: { total: 5, page: 1, pageSize: 3, pageCount: 2 },
    });
    await service.listTyreSets({
      cursor: encodeMcpCursor(2),
      pageSize: 2,
    });
    expect(tyreSetListRead.list).toHaveBeenCalledWith({
      skip: 2,
      pageSize: 3,
      customerId: undefined,
      vehicleId: undefined,
      status: undefined,
    });
  });

  it('rejects TECH callers for warranty claims', () => {
    const { service, warrantyClaimSiteList } = buildLists({ role: 'TECH' });
    expect(() => service.listWarrantyClaims({})).toThrow(ForbiddenException);
    expect(warrantyClaimSiteList.listAtActiveSite).not.toHaveBeenCalled();
  });
});

import { BadRequestException } from '@nestjs/common';
import { AgentSupervisionTriageService } from './agent-supervision-triage.service.js';
import type { SupervisionTriageCandidate } from './agent-supervision-triage-order.js';

function triageRow(
  overrides: Partial<SupervisionTriageCandidate> &
    Pick<SupervisionTriageCandidate, 'kind' | 'entity_id'>,
): SupervisionTriageCandidate {
  return {
    site_id: 'site-1',
    reason: 'TEST',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    due_at: null,
    record_link: '/test',
    allowed_action: 'OPEN_RECORD',
    ...overrides,
  };
}

describe('AgentSupervisionTriageService', () => {
  const tenantId = 'tenant-1';
  let service: AgentSupervisionTriageService;
  let mockTenantContext: { getTenantId: jest.Mock; getAuthenticatedUser: jest.Mock };
  let mockSiteContext: { listAuthorizedSiteIds: jest.Mock };
  let mockProposalReads: {
    listCustomerWaitingTriageCandidates: jest.Mock;
    listPendingApprovalTriageCandidates: jest.Mock;
  };
  let mockLoanerVehicles: { listOverdueTriageCandidates: jest.Mock };

  beforeEach(() => {
    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'user-1',
        tenantId,
        role: 'ADMIN',
      }),
    };
    mockSiteContext = {
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    };
    mockProposalReads = {
      listCustomerWaitingTriageCandidates: jest.fn().mockResolvedValue([]),
      listPendingApprovalTriageCandidates: jest.fn().mockResolvedValue([]),
    };
    mockLoanerVehicles = {
      listOverdueTriageCandidates: jest.fn().mockResolvedValue([]),
    };

    service = new AgentSupervisionTriageService(
      mockTenantContext as never,
      mockSiteContext as never,
      mockProposalReads as never,
      mockLoanerVehicles as never,
    );
  });

  it('fails the request when a triage source loader throws', async () => {
    mockLoanerVehicles.listOverdueTriageCandidates.mockRejectedValue(
      new Error('loaner db down'),
    );

    await expect(service.listTriage({ limit: 20 })).rejects.toThrow(
      'loaner db down',
    );
  });

  it('returns 400 for an invalid cursor', async () => {
    mockLoanerVehicles.listOverdueTriageCandidates.mockResolvedValue([
      triageRow({ kind: 'OVERDUE_LOANER', entity_id: 'l-1' }),
    ]);

    await expect(
      service.listTriage({ limit: 10, cursor: 'bad-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges and paginates rows from all sources', async () => {
    mockLoanerVehicles.listOverdueTriageCandidates.mockResolvedValue([
      triageRow({ kind: 'OVERDUE_LOANER', entity_id: 'l-1' }),
    ]);
    mockProposalReads.listCustomerWaitingTriageCandidates.mockResolvedValue([
      triageRow({ kind: 'CUSTOMER_WAITING', entity_id: 'c-1' }),
    ]);

    const result = await service.listTriage({ limit: 1 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].entity_id).toBe('l-1');
    expect(result.next_cursor).not.toBeNull();
  });
});

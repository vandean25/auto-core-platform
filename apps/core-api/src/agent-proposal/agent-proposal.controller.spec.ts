import type { AgentProposalAuthorization } from './agent-proposal.authorization.js';
import { AgentProposalController } from './agent-proposal.controller.js';
import type { AgentProposalService } from './agent-proposal.service.js';

describe('AgentProposalController', () => {
  let controller: AgentProposalController;
  let mockService: any;
  let mockAuth: any;

  beforeEach(() => {
    mockService = {
      listProposals: jest.fn().mockResolvedValue({ data: [] }),
      approveProposal: jest.fn().mockResolvedValue({ id: 'p-1', status: 'EXECUTED' }),
      rejectProposal: jest.fn().mockResolvedValue({ id: 'p-1', status: 'REJECTED' }),
      createProposal: jest.fn().mockResolvedValue({ id: 'p-1', status: 'PENDING' }),
      submitPendingAction: jest.fn().mockResolvedValue({ id: 'p-1', status: 'PENDING' }),
      batchApplyProposals: jest.fn().mockResolvedValue({ results: [] }),
    };

    mockAuth = {
      assertSupervisor: jest.fn(),
    };

    controller = new AgentProposalController(mockService, mockAuth);
  });

  it('delegates listProposals to service after asserting supervisor access', async () => {
    const result = await controller.listProposals({});
    expect(mockAuth.assertSupervisor).toHaveBeenCalled();
    expect(mockService.listProposals).toHaveBeenCalledWith({});
    expect(result).toEqual({ data: [] });
  });

  it('delegates approveProposal to service after asserting supervisor access', async () => {
    const result = await controller.approveProposal('p-1');
    expect(mockAuth.assertSupervisor).toHaveBeenCalled();
    expect(mockService.approveProposal).toHaveBeenCalledWith('p-1');
    expect(result.status).toBe('EXECUTED');
  });

  it('delegates rejectProposal to service after asserting supervisor access', async () => {
    const result = await controller.rejectProposal('p-1', { reason: 'not needed' });
    expect(mockAuth.assertSupervisor).toHaveBeenCalled();
    expect(mockService.rejectProposal).toHaveBeenCalledWith('p-1', { reason: 'not needed' });
    expect(result.status).toBe('REJECTED');
  });

  it('delegates createProposal to service after asserting supervisor access', async () => {
    const body = { action_type: 'workshop_order.add_line', payload_json: {} };
    const result = await controller.createProposal(body);
    expect(mockAuth.assertSupervisor).toHaveBeenCalled();
    expect(mockService.createProposal).toHaveBeenCalledWith(body);
    expect(result.status).toBe('PENDING');
  });

  it('delegates apply to service after asserting supervisor access', async () => {
    await controller.applyProposal('p-1');
    expect(mockAuth.assertSupervisor).toHaveBeenCalled();
    expect(mockService.approveProposal).toHaveBeenCalledWith('p-1');
  });

  it('delegates batch apply to service after asserting supervisor access', async () => {
    const body = { ids: ['p-1', 'p-2'] };
    await controller.batchApplyProposals(body);
    expect(mockAuth.assertSupervisor).toHaveBeenCalled();
    expect(mockService.batchApplyProposals).toHaveBeenCalledWith(body);
  });

  it('delegates REST pending submission to service', async () => {
    const body = { action_type: 'workshop_order.add_line', payload_json: {} };
    await controller.submitPendingAction(body);
    expect(mockService.submitPendingAction).toHaveBeenCalledWith(body);
  });
});

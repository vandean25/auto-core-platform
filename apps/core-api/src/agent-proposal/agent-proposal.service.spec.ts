import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentProposalService } from './agent-proposal.service.js';
import {
  createAgentProposalSpecHarness,
  createMockProposal,
} from './agent-proposal.spec.support.js';

describe('AgentProposalService', () => {
  let service: AgentProposalService;

  beforeEach(() => {
    ({ service } = createAgentProposalSpecHarness());
  });

  describe('batchApplyProposals', () => {
    it('returns independent outcomes when one proposal fails', async () => {
      jest.spyOn(service, 'approveProposal').mockImplementation(async (id) => {
        if (id === 'bad-id') throw new ConflictException('already claimed');
        return createMockProposal({ id }) as any;
      });

      const result = await service.batchApplyProposals({
        ids: ['good-id', 'bad-id'],
      });

      expect(result.results).toEqual([
        expect.objectContaining({ id: 'good-id', status: 'applied' }),
        expect.objectContaining({
          id: 'bad-id',
          status: 'failed',
          error: 'already claimed',
        }),
      ]);
      expect(service.approveProposal).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveLineItemFinancials', () => {
    it('throws BadRequestException for negative unit_price', () => {
      expect(() =>
        service.resolveLineItemFinancials({ unit_price: -1 }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for negative amount', () => {
      expect(() =>
        service.resolveLineItemFinancials({ amount_eur: -10 }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for nonpositive quantity', () => {
      expect(() => service.resolveLineItemFinancials({ quantity: 0 })).toThrow(
        BadRequestException,
      );
      expect(() => service.resolveLineItemFinancials({ quantity: -3 })).toThrow(
        BadRequestException,
      );
    });

    it('correctly calculates total from unit_price and quantity', () => {
      const result = service.resolveLineItemFinancials({
        unit_price: 25,
        quantity: 4,
      });
      expect(result).toEqual({
        unitPrice: 25,
        totalAmount: 100,
        quantity: 4,
      });
    });

    it('correctly calculates unit_price from amount and quantity', () => {
      const result = service.resolveLineItemFinancials({
        amount_eur: 150,
        quantity: 3,
      });
      expect(result).toEqual({
        unitPrice: 50,
        totalAmount: 150,
        quantity: 3,
      });
    });

    it('reconciles matching unit_price and amount', () => {
      const result = service.resolveLineItemFinancials({
        unit_price: 20,
        amount_eur: 40,
        quantity: 2,
      });
      expect(result).toEqual({
        unitPrice: 20,
        totalAmount: 40,
        quantity: 2,
      });
    });

    it('defaults to 0 amount and 1 quantity when empty', () => {
      const result = service.resolveLineItemFinancials({});
      expect(result).toEqual({
        unitPrice: 0,
        totalAmount: 0,
        quantity: 1,
      });
    });
  });

});

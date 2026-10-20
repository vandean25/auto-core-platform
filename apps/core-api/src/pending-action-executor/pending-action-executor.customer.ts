import {
  applyCustomerCreateProposal,
  applyCustomerUpdateProposal,
  enrichCustomerCreateProposal,
  enrichCustomerUpdateProposal,
  maskCustomerProposalPayload,
} from '../customer/customer-propose.js';
import type { CustomerCreateProposalPayload } from '../customer/customer-propose.payload.js';
import { maskProposalArgs } from '../customer/customer-propose.payload.js';
import {
  updateCustomer,
  type PendingActionHandlerDeps,
} from './pending-action-executor.handlers.js';
import type {
  PendingActionExecutor,
  PendingActionType,
} from './pending-action-executor.types.js';
import { asRecord } from './pending-action-executor.util.js';

function customerIdOf(result: unknown): string {
  const record = asRecord(result);
  const customerId = record.customer_id ?? record.id;
  return typeof customerId === 'string' ? customerId : '';
}

/**
 * Creates the customer of an approved create proposal (AUT-613). A create is
 * not reversible, so the action log records it as such.
 */
export function customerCreateExecutor(
  deps: PendingActionHandlerDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  return {
    actionType,
    buildPolicyContext: () => Promise.resolve({}),
    enrichInput: async (input) => {
      const tenantId = await deps.tenantContext.getTenantId();
      return enrichCustomerCreateProposal(
        { prisma: deps.prisma, tenantId },
        input,
      );
    },
    execute: async (input) => {
      const tenantId = await deps.tenantContext.getTenantId();
      const record = asRecord(input);
      const proposal =
        record.action === 'customer.create'
          ? (input as CustomerCreateProposalPayload)
          : await enrichCustomerCreateProposal(
              { prisma: deps.prisma, tenantId },
              input,
            );
      return applyCustomerCreateProposal(
        { prisma: deps.prisma, tenantId },
        proposal,
      );
    },
    buildResultSummary: (result) => ({
      customer_id: customerIdOf(result),
    }),
    buildLogMetadata: (result) => ({
      entityType: 'Customer',
      entityId: customerIdOf(result),
      reversible: false,
    }),
    maskProposalPayload: (payload) => maskCustomerProposalPayload(payload),
    maskLoggedArgs: (args) => maskProposalArgs(args),
  };
}

/**
 * Applies the changed fields of an approved update proposal (AUT-613). The
 * legacy customer.update payload, which carries the fields at the top level,
 * keeps working for proposals that were submitted before AUT-613.
 */
export function customerUpdateExecutor(
  deps: PendingActionHandlerDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  return {
    actionType,
    buildPolicyContext: () => Promise.resolve({}),
    enrichInput: async (input) => {
      const tenantId = await deps.tenantContext.getTenantId();
      return enrichCustomerUpdateProposal(
        { prisma: deps.prisma, tenantId },
        input,
      );
    },
    execute: async (input) => {
      const record = asRecord(input);
      if (record.action === 'customer.update') {
        const tenantId = await deps.tenantContext.getTenantId();
        return applyCustomerUpdateProposal(
          { prisma: deps.prisma, tenantId },
          input,
        );
      }
      if (record.changes === undefined) {
        return updateCustomer(deps, input);
      }
      const tenantId = await deps.tenantContext.getTenantId();
      const proposal = await enrichCustomerUpdateProposal(
        { prisma: deps.prisma, tenantId },
        input,
      );
      return applyCustomerUpdateProposal(
        { prisma: deps.prisma, tenantId },
        proposal,
      );
    },
    buildResultSummary: (result) => ({
      customer_id: customerIdOf(result),
    }),
    buildLogMetadata: (result) => ({
      entityType: 'Customer',
      entityId: customerIdOf(result),
      reversible: true,
    }),
    maskProposalPayload: (payload) => maskCustomerProposalPayload(payload),
    maskLoggedArgs: (args) => maskProposalArgs(args),
  };
}

import type { MechanicFindingProposeService } from './mechanic-finding-propose.service.js';

/** Stand-in when MechanicFindingProposeService is not injected (trace unit tests). */
export const mechanicFindingProposeNoop = {
  enrichInput: async (input: unknown) => input,
  buildProposalPayload: async () => ({
    action_type: 'workshop_order.mechanic_finding',
    payload_json: {},
    preview_json: {},
  }),
} satisfies Pick<
  MechanicFindingProposeService,
  'enrichInput' | 'buildProposalPayload'
>;

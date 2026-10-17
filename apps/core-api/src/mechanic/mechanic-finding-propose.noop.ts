import type { MechanicFindingProposeService } from './mechanic-finding-propose.service.js';

/** Stand-in when MechanicFindingProposeService is not injected (trace unit tests). */
export const mechanicFindingProposeNoop = {
  enrichInput: (input: unknown) => Promise.resolve(input),
  buildProposalPayload: () =>
    Promise.resolve({
      action_type: 'workshop_order.mechanic_finding',
      payload_json: {},
      preview_json: {},
    }),
} satisfies Pick<
  MechanicFindingProposeService,
  'enrichInput' | 'buildProposalPayload'
>;

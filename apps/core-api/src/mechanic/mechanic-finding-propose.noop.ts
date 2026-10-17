import type { MechanicFindingProposeService } from './mechanic-finding-propose.service.js';

/** Stand-in when MechanicFindingProposeService is not injected (trace unit tests). */
export const mechanicFindingProposeNoop = {
  enrichInput: (input: unknown) => Promise.resolve(input),
  normalizeSubmitPayload: (input: unknown) =>
    Promise.resolve(
      input !== null && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {},
    ),
  buildProposalPayload: () =>
    Promise.resolve({
      action_type: 'workshop_order.mechanic_finding',
      payload_json: {},
      preview_json: {},
    }),
} satisfies Pick<
  MechanicFindingProposeService,
  'enrichInput' | 'normalizeSubmitPayload' | 'buildProposalPayload'
>;

import type { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';

export async function enrichMechanicFindingSubmitPayload(
  mechanicFindingPropose: MechanicFindingProposeService,
  payload: unknown,
): Promise<unknown> {
  return mechanicFindingPropose.normalizeSubmitPayload(payload);
}

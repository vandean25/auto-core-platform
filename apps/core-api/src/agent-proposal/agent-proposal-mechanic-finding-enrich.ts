import type { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';

function isTabletMechanicFindingPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const finding = (payload as Record<string, unknown>).finding;
  return finding !== null && typeof finding === 'object' && !Array.isArray(finding);
}

export async function enrichMechanicFindingSubmitPayload(
  mechanicFindingPropose: MechanicFindingProposeService,
  payload: unknown,
): Promise<unknown> {
  if (isTabletMechanicFindingPayload(payload)) {
    return payload;
  }
  return mechanicFindingPropose.enrichInput(payload);
}

import { UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import {
  assertConditionsAtLeastAsStrictAs,
  mergeAgentPolicyConditions,
} from './agent-policy-conditions.util.js';
import { isTierAtLeastAsStrictAs } from './agent-policy-tier.util.js';

describe('agent policy conditions strictness', () => {
  const platform = { amount_max: 500, customer_facing: true };

  it('rejects looser tier than platform', () => {
    expect(
      isTierAtLeastAsStrictAs(AgentPolicyTier.AUTO, AgentPolicyTier.PROPOSE),
    ).toBe(false);
    expect(
      isTierAtLeastAsStrictAs(
        AgentPolicyTier.HUMAN_ONLY,
        AgentPolicyTier.AUTO,
      ),
    ).toBe(true);
  });

  it('rejects null or higher amount_max than platform', () => {
    expect(() =>
      assertConditionsAtLeastAsStrictAs({ amount_max: null }, platform),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertConditionsAtLeastAsStrictAs({ amount_max: 501 }, platform),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertConditionsAtLeastAsStrictAs(
        { amount_max: 400, customer_facing: true },
        platform,
      ),
    ).not.toThrow();
  });

  it('rejects dropping customer_facing when platform requires it', () => {
    expect(() =>
      assertConditionsAtLeastAsStrictAs(
        { amount_max: 500, customer_facing: false },
        platform,
      ),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertConditionsAtLeastAsStrictAs(
        { amount_max: 500, customer_facing: true },
        platform,
      ),
    ).not.toThrow();
  });

  it('merges partial overrides onto platform defaults', () => {
    expect(
      mergeAgentPolicyConditions(platform, { amount_max: 300 }),
    ).toEqual({
      amount_max: 300,
      customer_facing: true,
    });
    expect(mergeAgentPolicyConditions(platform)).toEqual(platform);
  });
});

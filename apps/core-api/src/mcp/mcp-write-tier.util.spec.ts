import { AgentPolicyTier } from '@prisma/client';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';

describe('effectiveMcpWriteTier', () => {
  it('holds propose_line_item at PROPOSE when policy says AUTO', () => {
    expect(
      effectiveMcpWriteTier('propose_line_item', AgentPolicyTier.AUTO),
    ).toBe(AgentPolicyTier.PROPOSE);
  });

  it('keeps the policy tier in every other case', () => {
    expect(
      effectiveMcpWriteTier('propose_line_item', AgentPolicyTier.PROPOSE),
    ).toBe(AgentPolicyTier.PROPOSE);
    expect(
      effectiveMcpWriteTier('propose_line_item', AgentPolicyTier.HUMAN_ONLY),
    ).toBe(AgentPolicyTier.HUMAN_ONLY);
    expect(effectiveMcpWriteTier('reserve_part', AgentPolicyTier.AUTO)).toBe(
      AgentPolicyTier.AUTO,
    );
    expect(
      effectiveMcpWriteTier('draft_workshop_order', AgentPolicyTier.AUTO),
    ).toBe(AgentPolicyTier.AUTO);
  });
});

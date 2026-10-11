import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, Prisma } from '@prisma/client';
import {
  assertTierNotLooserThanPlatform,
  normalizeActionType,
  resolveTenantConditions,
  toUpsertPersistenceError,
} from './agent-policy-upsert.util.js';

function thrownBy(fn: () => unknown): HttpException {
  try {
    fn();
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the call to throw');
}

describe('normalizeActionType', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeActionType('  inventory.part_reserve \n')).toBe(
      'inventory.part_reserve',
    );
  });

  it('rejects a blank action type with 400', () => {
    const error = thrownBy(() => normalizeActionType(' \t '));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      message: 'action_type is required',
    });
  });
});

describe('assertTierNotLooserThanPlatform', () => {
  it.each([
    [AgentPolicyTier.AUTO, AgentPolicyTier.AUTO],
    [AgentPolicyTier.PROPOSE, AgentPolicyTier.AUTO],
    [AgentPolicyTier.HUMAN_ONLY, AgentPolicyTier.PROPOSE],
  ])('allows a %s tier over a %s platform default', (tier, platformTier) => {
    expect(() =>
      assertTierNotLooserThanPlatform(tier, platformTier),
    ).not.toThrow();
  });

  it('rejects a looser tier with the looser-than-platform code', () => {
    const error = thrownBy(() =>
      assertTierNotLooserThanPlatform(
        AgentPolicyTier.AUTO,
        AgentPolicyTier.PROPOSE,
      ),
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toMatchObject({
      code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
    });
  });
});

describe('resolveTenantConditions', () => {
  it('layers the override on the platform conditions', () => {
    expect(
      resolveTenantConditions(
        { amount_max: 250, customer_facing: true },
        { amount_max: 100 },
      ),
    ).toEqual({ amount_max: 100, customer_facing: true });
  });

  it('returns the platform conditions when there is no override', () => {
    expect(resolveTenantConditions({ amount_max: 250 })).toEqual({
      amount_max: 250,
    });
  });

  it('throws when the override loosens the amount cap', () => {
    const error = thrownBy(() =>
      resolveTenantConditions({ amount_max: 250 }, { amount_max: 300 }),
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toMatchObject({
      code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
    });
  });
});

describe('toUpsertPersistenceError', () => {
  it('maps a unique violation on the version to a version conflict', () => {
    const error = toUpsertPersistenceError(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'AGENT_POLICY_VERSION_CONFLICT',
    });
  });

  it('maps the tier-looser database trigger to a 422', () => {
    const error = toUpsertPersistenceError(
      new Error('agent_policy_tenant_tier_looser_than_platform'),
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
    });
  });

  it('returns any other error unchanged, including other Prisma codes', () => {
    const foreignKey = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      { code: 'P2003', clientVersion: '7.10.0' },
    );
    const plain = new Error('connection terminated');

    expect(toUpsertPersistenceError(foreignKey)).toBe(foreignKey);
    expect(toUpsertPersistenceError(plain)).toBe(plain);
  });
});

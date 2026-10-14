import { Logger } from '@nestjs/common';
import { DecisionModeResolver } from './decision-mode-resolver.service.js';

const TENANT_ID = 'tenant-1';
const ORIGINAL_ENV = { ...process.env };

function buildResolver(
  tenantRow: { decision_apply_mode: string | null } | null | Error = {
    decision_apply_mode: null,
  },
) {
  const findUnique = jest.fn();
  if (tenantRow instanceof Error) {
    findUnique.mockRejectedValue(tenantRow);
  } else {
    findUnique.mockResolvedValue(tenantRow);
  }
  const prisma = { tenant: { findUnique } };
  return {
    resolver: new DecisionModeResolver(prisma as never),
    findUnique,
  };
}

describe('DecisionModeResolver', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      DECISION_APPLY_MODE: 'live',
    };
    delete process.env.DECISION_LIVE_OPT_IN;
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  it('stays in shadow without reading the tenant row when the environment is shadow', async () => {
    delete process.env.DECISION_APPLY_MODE;
    const { resolver, findUnique } = buildResolver();

    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'shadow',
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('is live when the environment is live and the tenant has not opted out', async () => {
    const { resolver, findUnique } = buildResolver({
      decision_apply_mode: null,
    });

    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'live',
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      select: { decision_apply_mode: true },
    });
    await expect(resolver.isLiveForTenant(TENANT_ID)).resolves.toBe(true);
  });

  it('lets a tenant opt out with decision_apply_mode=shadow', async () => {
    const { resolver } = buildResolver({ decision_apply_mode: 'shadow' });

    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'shadow',
    );
    await expect(resolver.isLiveForTenant(TENANT_ID)).resolves.toBe(false);
  });

  it('stays in shadow when the tenant row is missing', async () => {
    const { resolver } = buildResolver(null);

    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'shadow',
    );
  });

  it('falls back to shadow and logs only the error name when the lookup fails', async () => {
    const { resolver } = buildResolver(new TypeError('connection reset'));

    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'shadow',
    );
    expect(warn).toHaveBeenCalledWith(
      'Decision apply mode lookup failed; using shadow: TypeError',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('connection reset');
  });

  it('warns once when a production runtime asks for live without the opt-in', async () => {
    process.env.NODE_ENV = 'production';
    const { resolver, findUnique } = buildResolver({
      decision_apply_mode: null,
    });

    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'shadow',
    );
    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'shadow',
    );

    expect(findUnique).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'DECISION_APPLY_MODE=live ignored: production runtime needs DECISION_LIVE_OPT_IN=true. Using shadow.',
    );
  });

  it('is live in production only with DECISION_LIVE_OPT_IN=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DECISION_LIVE_OPT_IN = 'true';
    const { resolver } = buildResolver({ decision_apply_mode: null });

    await expect(resolver.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
      'live',
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

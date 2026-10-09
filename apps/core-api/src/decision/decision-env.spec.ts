import {
  readDecisionApplyMode,
  resolveEnvDecisionApplyMode,
} from './decision-env.js';

describe('decision apply mode (environment)', () => {
  it('defaults to shadow when DECISION_APPLY_MODE is unset', () => {
    expect(readDecisionApplyMode({})).toBe('shadow');
  });

  it.each(['on', 'true', '1', 'yes', 'enabled', ''])(
    'treats unknown value %j as shadow',
    (value) => {
      expect(readDecisionApplyMode({ DECISION_APPLY_MODE: value })).toBe(
        'shadow',
      );
    },
  );

  it('accepts live case-insensitively and ignores surrounding whitespace', () => {
    expect(readDecisionApplyMode({ DECISION_APPLY_MODE: '  LIVE ' })).toBe(
      'live',
    );
  });

  it('keeps live outside a production runtime without an opt-in flag', () => {
    expect(
      resolveEnvDecisionApplyMode({
        DECISION_APPLY_MODE: 'live',
        NODE_ENV: 'test',
      }),
    ).toEqual({ mode: 'live', blockedByProductionGate: false });
  });

  it('forces shadow in a production runtime without DECISION_LIVE_OPT_IN', () => {
    expect(
      resolveEnvDecisionApplyMode({
        DECISION_APPLY_MODE: 'live',
        NODE_ENV: 'production',
      }),
    ).toEqual({ mode: 'shadow', blockedByProductionGate: true });
  });

  it('allows live in a production runtime only with DECISION_LIVE_OPT_IN=true', () => {
    expect(
      resolveEnvDecisionApplyMode({
        DECISION_APPLY_MODE: 'live',
        NODE_ENV: 'production',
        DECISION_LIVE_OPT_IN: 'true',
      }),
    ).toEqual({ mode: 'live', blockedByProductionGate: false });
  });

  it.each(['yes', '1', 'on'])(
    'does not accept DECISION_LIVE_OPT_IN=%j as an opt-in',
    (optIn) => {
      expect(
        resolveEnvDecisionApplyMode({
          DECISION_APPLY_MODE: 'live',
          NODE_ENV: 'production',
          DECISION_LIVE_OPT_IN: optIn,
        }),
      ).toEqual({ mode: 'shadow', blockedByProductionGate: true });
    },
  );

  it('never reports the production gate when shadow is requested', () => {
    expect(
      resolveEnvDecisionApplyMode({ NODE_ENV: 'production' }),
    ).toEqual({ mode: 'shadow', blockedByProductionGate: false });
  });
});

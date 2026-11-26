import { FiskalySignAtFixtureProvider } from './fiskaly-sign-at-fixture.provider.js';
import { FiskalySignAtHttpAdapter } from './fiskaly-sign-at-http.adapter.js';
import { selectFiskalySignAtProvider } from './settlement.module.js';

describe('selectFiskalySignAtProvider (AUT-1071)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLiveFlag = process.env.FISKALY_SIGN_AT_LIVE_ENABLED;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalLiveFlag === undefined) {
      delete process.env.FISKALY_SIGN_AT_LIVE_ENABLED;
    } else {
      process.env.FISKALY_SIGN_AT_LIVE_ENABLED = originalLiveFlag;
    }
  });

  it.each(['production', 'development', 'staging', undefined])(
    'never selects the fixture provider outside test/CI (NODE_ENV=%s)',
    (nodeEnv) => {
      if (nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = nodeEnv;
      }
      delete process.env.FISKALY_SIGN_AT_LIVE_ENABLED;

      const fixture = new FiskalySignAtFixtureProvider();
      const http = new FiskalySignAtHttpAdapter(null, false);

      expect(selectFiskalySignAtProvider(fixture, http)).toBe(http);
    },
  );

  it('selects the HTTP adapter in test when FISKALY_SIGN_AT_LIVE_ENABLED=true', () => {
    process.env.NODE_ENV = 'test';
    process.env.FISKALY_SIGN_AT_LIVE_ENABLED = 'true';

    const fixture = new FiskalySignAtFixtureProvider();
    const http = new FiskalySignAtHttpAdapter(null, false);

    expect(selectFiskalySignAtProvider(fixture, http)).toBe(http);
  });

  it('selects the fixture provider only in test when live signing is off', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FISKALY_SIGN_AT_LIVE_ENABLED;

    const fixture = new FiskalySignAtFixtureProvider();
    const http = new FiskalySignAtHttpAdapter(null, false);

    expect(selectFiskalySignAtProvider(fixture, http)).toBe(fixture);
  });
});

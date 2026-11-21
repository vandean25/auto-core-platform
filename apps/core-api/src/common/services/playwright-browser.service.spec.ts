import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { PlaywrightBrowserService } from './playwright-browser.service.js';

// The service only calls isConnected and close on these fakes.
function asBrowser(browser: Partial<Browser>) {
  return browser as Browser;
}

describe('PlaywrightBrowserService', () => {
  let service: PlaywrightBrowserService;

  beforeEach(() => {
    service = new PlaywrightBrowserService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reuses the in-flight browser launch request', async () => {
    const browser: Partial<Browser> = {
      isConnected: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const launchSpy = jest
      .spyOn(chromium, 'launch')
      .mockResolvedValue(asBrowser(browser));

    const [first, second] = await Promise.all([
      service.getBrowser(),
      service.getBrowser(),
    ]);

    expect(first).toBe(browser);
    expect(second).toBe(browser);
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it('relaunches when the cached browser is disconnected', async () => {
    const disconnectedBrowser: Partial<Browser> = {
      isConnected: jest.fn().mockReturnValue(false),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const liveBrowser: Partial<Browser> = {
      isConnected: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (service as unknown as { browser: unknown }).browser = disconnectedBrowser;

    const launchSpy = jest
      .spyOn(chromium, 'launch')
      .mockResolvedValue(asBrowser(liveBrowser));

    await expect(service.getBrowser()).resolves.toBe(liveBrowser);
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects timed operations after the given timeout', async () => {
    jest.useFakeTimers();

    const pending = new Promise<never>(() => undefined);
    const rejection = expect(
      service.withTimeout(pending, 15_000, 'Playwright timed out'),
    ).rejects.toThrow('Playwright timed out');

    await jest.advanceTimersByTimeAsync(15_000);
    await rejection;
  });

  it('warms Chromium on module init when enabled and reuses it on first getBrowser', async () => {
    const browser: Partial<Browser> = {
      isConnected: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const launchSpy = jest
      .spyOn(chromium, 'launch')
      .mockResolvedValue(asBrowser(browser));
    const prevWarm = process.env.PDF_WORKER_WARM_CHROMIUM;
    process.env.PDF_WORKER_WARM_CHROMIUM = 'true';

    try {
      service.onModuleInit();
      await Promise.resolve();
      const resolved = await service.getBrowser();

      expect(resolved).toBe(browser);
      expect(launchSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (prevWarm === undefined) {
        delete process.env.PDF_WORKER_WARM_CHROMIUM;
      } else {
        process.env.PDF_WORKER_WARM_CHROMIUM = prevWarm;
      }
    }
  });

  it('does not throw from warmBrowser if startup Chromium launch fails', async () => {
    jest
      .spyOn(chromium, 'launch')
      .mockRejectedValueOnce(new Error('Chromium binary missing'));

    await expect(service.warmBrowser()).resolves.toBeUndefined();
  });

  it('skips startup warm-up in test and core-api environments, enables it in pdf-worker production', async () => {
    const { shouldWarmPlaywrightBrowser } = await import(
      './playwright-browser.service.js'
    );

    expect(
      shouldWarmPlaywrightBrowser({
        NODE_ENV: 'production',
        PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
      }),
    ).toBe(true);

    expect(
      shouldWarmPlaywrightBrowser({
        NODE_ENV: 'production',
        CLOUD_TASKS_ENABLED: 'true',
      }),
    ).toBe(false);

    expect(
      shouldWarmPlaywrightBrowser({
        NODE_ENV: 'test',
        PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
      }),
    ).toBe(false);
  });
});

import { chromium } from 'playwright';
import { PlaywrightBrowserService } from './playwright-browser.service';

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
    const browser = {
      isConnected: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const launchSpy = jest
      .spyOn(chromium, 'launch')
      .mockResolvedValue(browser);

    const [first, second] = await Promise.all([
      service.getBrowser(),
      service.getBrowser(),
    ]);

    expect(first).toBe(browser);
    expect(second).toBe(browser);
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it('relaunches when the cached browser is disconnected', async () => {
    const disconnectedBrowser = {
      isConnected: jest.fn().mockReturnValue(false),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const liveBrowser = {
      isConnected: jest.fn().mockReturnValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (service as unknown as { browser: unknown }).browser = disconnectedBrowser;

    const launchSpy = jest
      .spyOn(chromium, 'launch')
      .mockResolvedValue(liveBrowser);

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
});

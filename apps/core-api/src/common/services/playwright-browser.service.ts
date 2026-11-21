import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';

export function shouldWarmPlaywrightBrowser(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.PDF_WORKER_WARM_CHROMIUM === 'true') {
    return true;
  }
  if (env.PDF_WORKER_WARM_CHROMIUM === 'false') {
    return false;
  }
  // Only the pdf-worker image bundles Chromium (PLAYWRIGHT_BROWSERS_PATH) without Cloud Tasks producer config.
  return (
    env.NODE_ENV === 'production' &&
    Boolean(env.PLAYWRIGHT_BROWSERS_PATH?.trim()) &&
    env.CLOUD_TASKS_ENABLED !== 'true'
  );
}

@Injectable()
export class PlaywrightBrowserService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightBrowserService.name);
  private browser: Browser | null = null;
  private browserInitPromise: Promise<Browser> | null = null;

  onModuleInit(): void {
    if (shouldWarmPlaywrightBrowser()) {
      void this.warmBrowser();
    }
  }

  async warmBrowser(): Promise<void> {
    try {
      await this.getBrowser();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to warm Playwright browser on startup: ${message}`,
      );
    }
  }

  async getBrowser(): Promise<Browser> {
    if (this.browser && !this.browser.isConnected()) {
      this.logger.warn(
        'Detected a disconnected Playwright browser instance; relaunching.',
      );
      this.browser = null;
      this.browserInitPromise = null;
    }

    if (!this.browser) {
      if (!this.browserInitPromise) {
        this.browserInitPromise = chromium
          .launch()
          .then((browser) => {
            this.browser = browser;
            return browser;
          })
          .catch((error) => {
            this.browserInitPromise = null;
            throw error;
          });
      }

      this.browser = await this.browserInitPromise;
    }

    return this.browser;
  }

  async onModuleDestroy() {
    if (!this.browser) {
      this.browserInitPromise = null;
      return;
    }

    try {
      await this.browser.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to close Playwright browser during shutdown: ${message}`,
        stack,
      );
    } finally {
      this.browser = null;
      this.browserInitPromise = null;
    }
  }

  async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';

@Injectable()
export class PlaywrightBrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightBrowserService.name);
  private browser: Browser | null = null;
  private browserInitPromise: Promise<Browser> | null = null;

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

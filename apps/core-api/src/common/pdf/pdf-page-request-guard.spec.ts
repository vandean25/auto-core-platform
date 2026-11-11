import type { Route } from 'playwright';
import { installPdfRendererRequestGuard } from './pdf-page-request-guard.js';

describe('installPdfRendererRequestGuard', () => {
  it('aborts file, http(s) and other non-data requests and continues data URIs', async () => {
    const handlers: Array<(route: Route) => void | Promise<void>> = [];
    const page = {
      route: jest.fn(async (_pattern: string, handler: (route: Route) => void) => {
        handlers.push(handler);
      }),
    };

    await installPdfRendererRequestGuard(page as never);
    expect(page.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    const handler = handlers[0];
    if (!handler) {
      throw new Error('Expected a registered route handler.');
    }

    const cases = [
      { url: 'https://example.test/logo.png', action: 'abort' as const },
      { url: 'http://127.0.0.1:1/font.woff2', action: 'abort' as const },
      { url: 'file:///etc/passwd', action: 'abort' as const },
      { url: 'about:blank', action: 'abort' as const },
      { url: 'data:image/png;base64,AAAA', action: 'continue' as const },
    ];

    for (const { url, action } of cases) {
      const abort = jest.fn();
      const cont = jest.fn();
      await handler({
        request: () => ({ url: () => url }),
        abort,
        continue: cont,
      } as never);
      if (action === 'abort') {
        expect(abort).toHaveBeenCalledTimes(1);
        expect(cont).not.toHaveBeenCalled();
      } else {
        expect(cont).toHaveBeenCalledTimes(1);
        expect(abort).not.toHaveBeenCalled();
      }
      abort.mockClear();
      cont.mockClear();
    }
  });
});

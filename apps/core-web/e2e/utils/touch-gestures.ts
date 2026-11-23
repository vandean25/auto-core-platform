import type { CDPSession, Page } from '@playwright/test'

export interface TouchPoint {
  x: number
  y: number
}

export class TouchGestureClient {
  private constructor(private readonly cdp: CDPSession) {}

  static async create(page: Page): Promise<TouchGestureClient> {
    const cdp = await page.context().newCDPSession(page)
    return new TouchGestureClient(cdp)
  }

  async start(point: TouchPoint): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(point.x), y: Math.round(point.y), id: 1 }],
    })
  }

  async move(from: TouchPoint, to: TouchPoint, steps = 10): Promise<void> {
    for (let step = 1; step <= steps; step += 1) {
      const x = Math.round(from.x + ((to.x - from.x) * step) / steps)
      const y = Math.round(from.y + ((to.y - from.y) * step) / steps)
      await this.cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y, id: 1 }],
      })
    }
  }

  async end(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
  }

  async swipe(from: TouchPoint, to: TouchPoint, steps = 8): Promise<void> {
    await this.start(from)
    await this.move(from, to, steps)
    await this.end()
  }

  async dispose(): Promise<void> {
    await this.cdp.detach().catch(() => {})
  }
}

import { expect, type Locator, type Page } from '@playwright/test'

export const PHONE_WIDTHS = [375, 390] as const

/** Pixels the page is wider than the screen (0 when there is no horizontal page scroll). */
export async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/**
 * Elements whose box or visible content (text that runs past a box with `overflow: visible`) reaches past the
 * right edge of the screen, for a readable failure message. Content inside scroll containers is fine.
 */
export async function elementsPastTheScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const clips = (node: HTMLElement) => /(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowX)
    const insideClip = (node: HTMLElement) => {
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (clips(parent)) return true
      }
      return false
    }
    const past = [...document.body.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.getClientRects().length > 0 && !insideClip(node))
      .filter((node) => {
        const box = node.getBoundingClientRect()
        const content = clips(node) ? box.right : box.left + Math.max(node.scrollWidth, box.width)
        return Math.max(box.right, content) > width + 1
      })
    // Report the innermost elements: their ancestors only inherit the overflow.
    return past
      .filter((node) => !past.some((other) => other !== node && node.contains(other)))
      .slice(0, 8)
      .map((node) => `${node.tagName.toLowerCase()}[${node.getAttribute('data-testid') ?? ''}].${String(node.className).slice(0, 80)} right=${Math.round(node.getBoundingClientRect().right)} scrollWidth=${node.scrollWidth}`)
  })
}

export async function expectNoPageScroll(page: Page) {
  expect(await elementsPastTheScreen(page), 'elements past the right edge').toEqual([])
  expect(await pageOverflow(page), 'page is wider than the screen').toBeLessThanOrEqual(0)
}

/** A control is fully on screen and at least 44px high. */
export async function expectReachableControl(control: Locator, width: number) {
  await expect(control).toBeVisible()
  const box = (await control.boundingBox())!
  expect(box.x, 'left edge').toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, 'right edge').toBeLessThanOrEqual(width)
  expect(box.height, 'height').toBeGreaterThanOrEqual(44)
}

/** Interactive controls inside `scope` that are shorter than 44px, for a readable failure message. */
export async function controlsShorterThan44(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]):not([type=checkbox]), select, textarea, [role=tab], [role=combobox]')]
      .filter((node) => node.getClientRects().length > 0 && node.getBoundingClientRect().height < 43.5)
      .slice(0, 8)
      .map((node) => `${node.tagName.toLowerCase()}[${node.getAttribute('data-testid') ?? node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30) ?? ''}] h=${Math.round(node.getBoundingClientRect().height)}`),
  )
}

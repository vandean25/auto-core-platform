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
    // Only scroll containers make wide content fine; `hidden`/`clip` cut the content off, which is the bug.
    const scrolls = (node: HTMLElement) => /(auto|scroll)/.test(getComputedStyle(node).overflowX)
    const insideClip = (node: HTMLElement) => {
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (scrolls(parent)) return true
      }
      return false
    }
    const past = [...document.body.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.getClientRects().length > 0 && !insideClip(node))
      .filter((node) => {
        const box = node.getBoundingClientRect()
        const content = scrolls(node) ? box.right : box.left + Math.max(node.scrollWidth, box.width)
        return box.left < -1 || Math.max(box.right, content) > width + 1
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

/** Every select and input in `scope` sits inside its own card (the nearest rounded, bordered box), never past its edge. */
export async function controlsOutsideTheirCard(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('select, input:not([type=hidden]):not([type=checkbox])')]
      .filter((node) => node.getClientRects().length > 0)
      .filter((node) => {
        const card = node.closest<HTMLElement>('.rounded-lg')
        if (!card) return false
        const box = node.getBoundingClientRect()
        const outer = card.getBoundingClientRect()
        return box.left < outer.left - 0.5 || box.right > outer.right + 0.5
      })
      .map((node) => `${node.tagName.toLowerCase()}[${node.getAttribute('data-testid') ?? node.id}]`),
  )
}

/** Interactive controls inside `scope` that are shorter than 44px, for a readable failure message. */
export async function controlsShorterThan44(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('button, a[href], summary, input:not([type=hidden]):not([type=checkbox]), select, textarea, [role=tab], [role=combobox]')]
      .filter((node) => {
        if (node.getClientRects().length === 0) return false
        const box = node.getBoundingClientRect()
        const iconOnly = !node.textContent?.trim() && node.tagName === 'BUTTON'
        return box.height < 43.5 || (iconOnly && box.width < 43.5)
      })
      .slice(0, 8)
      .map((node) => `${node.tagName.toLowerCase()}[${node.getAttribute('data-testid') ?? node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30) ?? ''}] ${Math.round(node.getBoundingClientRect().width)}x${Math.round(node.getBoundingClientRect().height)}`),
  )
}

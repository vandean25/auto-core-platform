import { test, expect, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { PHONE_WIDTHS, expectNoPageScroll } from './utils/phone-layout'

/** AUT-791 follow-up: the date placeholder "TT.MM.JJJJ" of the date filters is readable in full at 375 and 390px. */
const PLACEHOLDER = 'TT.MM.JJJJ'
const PAGES = [
  ['Reifenlager', '/workshop/tyre-storage'],
  ['Kostenvoranschläge', '/workshop/estimates'],
  ['Werkstatt-KPIs', '/workshop/reports/kpis'],
  ['Exportbereitschaft', '/finance/accounting-export-readiness'],
] as const

type FieldFit = { index: number; inputWidth: number; textWidth: number; needed: number }

/** Width the placeholder text needs against the width the input offers it (inside its padding). */
async function dateFieldFits(page: Page): Promise<FieldFit[]> {
  return page.evaluate((placeholder) => {
    const canvas = document.createElement('canvas').getContext('2d')!
    return Array.from(document.querySelectorAll<HTMLInputElement>(`input[placeholder="${placeholder}"]`)).map((input, index) => {
      const style = getComputedStyle(input)
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const textWidth = canvas.measureText(placeholder).width
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      return { index, inputWidth: input.clientWidth, textWidth, needed: textWidth + padding }
    })
  }, PLACEHOLDER)
}

test.describe('Date filter placeholders on a phone (AUT-791)', () => {
  for (const width of PHONE_WIDTHS) {
    for (const [name, path] of PAGES) {
      test(`${name} at ${width}px: every date placeholder fits`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 })
        await new AutoCorePage(page, '').navigate(path)
        await expect(page.locator(`input[placeholder="${PLACEHOLDER}"]`).first()).toBeVisible()

        // The canvas measures with the font the page has loaded by now, not a fallback.
        await page.evaluate(() => document.fonts.ready)
        const fits = await dateFieldFits(page)
        expect(fits.length, 'date fields on the page').toBeGreaterThan(0)
        for (const fit of fits) {
          expect(fit.inputWidth, `date field ${fit.index}: ${Math.ceil(fit.needed)}px needed`).toBeGreaterThanOrEqual(fit.needed)
        }
        await expectNoPageScroll(page)
      })
    }
  }
})

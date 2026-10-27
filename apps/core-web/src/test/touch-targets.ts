const INTERACTIVE =
  'button, a[href], input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select, [role=button], [role=combobox], [role=radio], [role=switch]'

// jsdom has no layout, so the 44px rule is checked on the classes that set it (as the queue test did).
const TOUCH_TARGET_CLASS = /(^|\s)(min-h-11|min-h-12|h-11|h-12|size-11|size-12|min-h-\[(4[4-9]|[5-9]\d)px\])(\s|$)/

/** Interactive elements below `root` that do not carry a 44px height class. */
export function findSmallTouchTargets(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE))
    .filter((element) => !TOUCH_TARGET_CLASS.test(element.className))
    .map((element) => `${element.tagName.toLowerCase()} "${element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.getAttribute('placeholder') ?? ''}"`)
}

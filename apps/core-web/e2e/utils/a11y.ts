import { expect, Page, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Rule tags the scan runs (AUT-482). WCAG 2.2 AA is `wcag22aa` on top of the 2.0/2.1 A and AA tags;
 * `best-practice` stays in so the moderate findings report keeps the rules it had before. AAA is
 * not in scope.
 */
export const A11Y_AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** axe impact levels we fail the build on (phase 2). */
const FAIL_IMPACTS = new Set(['critical', 'serious']);

/** Rules that fail the build at any impact (AUT-482): contrast is enforced whatever axe rates it. */
const FAIL_RULE_IDS = new Set(['color-contrast']);

const REPORT_ONLY_IMPACTS = new Set(['moderate', 'minor']);

/**
 * Known violations not fixed in this pass. Key: `${ruleId}@${pagePathPattern}` or ruleId for global.
 * See docs/a11y-backlog.md for rationale and follow-ups.
 */
export const A11Y_ALLOWLIST: Array<{
  ruleId: string;
  /** RegExp tested against page.url() pathname; omit to allow on any page. */
  pathPattern?: RegExp;
  reason: string;
}> = [];

function isAllowlisted(
  ruleId: string,
  pathname: string,
  entry: (typeof A11Y_ALLOWLIST)[number],
): boolean {
  if (entry.ruleId !== ruleId) return false;
  if (!entry.pathPattern) return true;
  return entry.pathPattern.test(pathname);
}

export async function expectNoCriticalA11yViolations(page: Page) {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(A11Y_AXE_TAGS)
    .analyze();
  const pathname = new URL(page.url()).pathname;

  await test.info().attach('accessibility-scan-results', {
    body: JSON.stringify(accessibilityScanResults, null, 2),
    contentType: 'application/json',
  });

  const backlogViolations = accessibilityScanResults.violations.filter(
    (v) => REPORT_ONLY_IMPACTS.has(v.impact ?? '') && !FAIL_RULE_IDS.has(v.id),
  );
  if (backlogViolations.length > 0) {
    await test.info().attach('accessibility-backlog-violations', {
      body: JSON.stringify(
        backlogViolations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }

  const failingViolations = accessibilityScanResults.violations.filter((v) => {
    if (!FAIL_IMPACTS.has(v.impact ?? '') && !FAIL_RULE_IDS.has(v.id)) return false;
    const allowlisted = A11Y_ALLOWLIST.some((entry) =>
      isAllowlisted(v.id, pathname, entry),
    );
    return !allowlisted;
  });

  if (failingViolations.length > 0) {
    const summary = failingViolations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.length,
      help: v.help,
    }));
    expect(
      failingViolations,
      `Accessibility violations (critical/serious or color-contrast) on ${pathname}:\n${JSON.stringify(summary, null, 2)}`,
    ).toEqual([]);
  }
}

/**
 * Fails on any violation of the given axe rules, whatever their impact. For focused checks
 * (e.g. `document-title`, AUT-473) where the rest of the page is out of scope.
 */
export async function expectNoAxeViolationsForRules(page: Page, ruleIds: string[]) {
  const { violations } = await new AxeBuilder({ page }).withRules(ruleIds).analyze();

  expect(
    violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.html),
    })),
  ).toEqual([]);
}

/**
 * Heading outline (axe `heading-order`): a heading may only be one level deeper than the
 * heading before it, so h1 → h3 fails. axe rates the rule "moderate", so the helper above does
 * not enforce it; pages with a clean outline call this helper in addition.
 */
export async function expectNoHeadingOrderViolations(page: Page) {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withRules(['heading-order'])
    .analyze();
  const pathname = new URL(page.url()).pathname;

  await test.info().attach('heading-order-scan-results', {
    body: JSON.stringify(accessibilityScanResults, null, 2),
    contentType: 'application/json',
  });

  const summary = accessibilityScanResults.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((node) => ({ target: node.target, html: node.html })),
  }));
  expect(
    summary,
    `heading-order violations on ${pathname}:\n${JSON.stringify(summary, null, 2)}`,
  ).toEqual([]);
}

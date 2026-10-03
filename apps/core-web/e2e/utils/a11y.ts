import { expect, Page, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** axe impact levels we fail the build on (phase 2). */
const FAIL_IMPACTS = new Set(['critical', 'serious']);

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
  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  const pathname = new URL(page.url()).pathname;

  await test.info().attach('accessibility-scan-results', {
    body: JSON.stringify(accessibilityScanResults, null, 2),
    contentType: 'application/json',
  });

  const backlogViolations = accessibilityScanResults.violations.filter((v) =>
    REPORT_ONLY_IMPACTS.has(v.impact ?? ''),
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
    if (!FAIL_IMPACTS.has(v.impact ?? '')) return false;
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
      `Accessibility violations (critical/serious) on ${pathname}:\n${JSON.stringify(summary, null, 2)}`,
    ).toEqual([]);
  }
}

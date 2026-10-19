import type { MigrationValidationIssue } from './migration-manifest.types.js';

export function pushMigrationIssue(
  issues: MigrationValidationIssue[],
  issue: MigrationValidationIssue,
): void {
  issues.push(issue);
}

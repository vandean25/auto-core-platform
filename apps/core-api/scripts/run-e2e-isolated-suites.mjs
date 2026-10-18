/** Suites that must run alone so Jest env hooks can target a single MCP stack. */
export const isolatedE2eSuiteSuffixes = [
  'mcp-compliance-reads.aut605.e2e-spec.ts',
];

/**
 * @param {string[]} testFiles absolute or relative paths from Jest listTests
 * @param {number} size batch size for shared suites
 * @param {(items: string[], size: number) => string[][]} chunkItems
 */
export function batchE2eSuitesWithIsolated(testFiles, size, chunkItems) {
  const isolated = [];
  const shared = [];
  for (const file of testFiles) {
    if (isolatedE2eSuiteSuffixes.some((suffix) => file.endsWith(suffix))) {
      isolated.push(file);
    } else {
      shared.push(file);
    }
  }
  const batches = chunkItems(shared, size);
  for (const file of isolated) {
    batches.push([file]);
  }
  return batches;
}

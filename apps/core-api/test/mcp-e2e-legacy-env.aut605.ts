const e2eSpecPaths = process.argv.filter((arg) => arg.includes('e2e-spec'));
const runsLegacyMcpE2e = e2eSpecPaths.some((arg) =>
  arg.endsWith('mcp.e2e-spec.ts'),
);
const runsComplianceMcpE2e = e2eSpecPaths.some((arg) =>
  arg.includes('mcp-compliance-reads.aut605'),
);

if (runsLegacyMcpE2e && !runsComplianceMcpE2e) {
  process.env.MCP_E2E_LEGACY_STACK = 'true';
}

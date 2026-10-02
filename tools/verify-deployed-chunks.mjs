#!/usr/bin/env node
/**
 * Report-only post-deploy check (AUT-347): fetches live Hosting index.html and
 * reports missing chunk URLs. Does not abort or roll back a release — Firebase
 * Hosting deploys are atomic and this script is informational only.
 */
import { parseIndexHtmlReferencedPaths } from './verify-build-chunks-lib.mjs';

const baseUrl = (process.env.HOSTING_BASE_URL ?? process.env._FRONTEND_URL ?? '').replace(
  /\/$/,
  '',
);

if (!baseUrl) {
  console.error(
    'Set HOSTING_BASE_URL (or _FRONTEND_URL) to the deployed site origin, e.g. https://auto-core-platform-vande.web.app',
  );
  process.exit(0);
}

const indexUrl = `${baseUrl}/index.html`;
const response = await fetch(indexUrl, { redirect: 'follow' });
if (!response.ok) {
  console.warn(
    `[verify-deployed-chunks] report-only: could not fetch ${indexUrl} (HTTP ${response.status})`,
  );
  process.exit(0);
}

const indexHtml = await response.text();
const paths = parseIndexHtmlReferencedPaths(indexHtml);
const missing = [];

for (const sitePath of paths) {
  const url = new URL(sitePath, baseUrl);
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (head.status === 405) {
    const get = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!get.ok) {
      missing.push(`${sitePath} (HTTP ${get.status})`);
    }
    continue;
  }
  if (!head.ok) {
    missing.push(`${sitePath} (HTTP ${head.status})`);
  }
}

if (missing.length === 0) {
  console.log(
    `[verify-deployed-chunks] report-only: all ${paths.length} index.html asset URLs responded OK at ${baseUrl}`,
  );
} else {
  console.warn(
    `[verify-deployed-chunks] report-only: ${missing.length} missing or failed asset(s) (does not abort deploy):\n${missing.map((line) => `  - ${line}`).join('\n')}`,
  );
}

process.exit(0);

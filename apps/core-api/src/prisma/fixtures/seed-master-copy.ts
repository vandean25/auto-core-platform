import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DisplayLanguage } from '../../common/i18n/display-language.js';

export type SeedMasterBundle = {
  pickerl: {
    title: string;
    items: Record<string, string>;
  };
  annahme: {
    title: string;
    items: Record<string, string>;
  };
  landingDemo: {
    tenantName: string;
    siteName: string;
    storage: Record<string, string>;
  };
};

function localesRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const bundled = resolve(moduleDir, '../../../locales');
  if (existsSync(bundled)) {
    return bundled;
  }
  return resolve(moduleDir, '../../../../../locales');
}

export function loadSeedMasterCopy(
  language: DisplayLanguage,
): SeedMasterBundle {
  const filePath = resolve(localesRoot(), language, 'seedMaster.json');
  return JSON.parse(readFileSync(filePath, 'utf8')) as SeedMasterBundle;
}

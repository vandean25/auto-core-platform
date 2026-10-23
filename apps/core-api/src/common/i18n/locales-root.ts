import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type LocalesDirectoryExists = (directoryPath: string) => boolean;

export function resolveLocalesRoot(
  moduleDir: string,
  directoryExists: LocalesDirectoryExists = existsSync,
): string {
  const candidates = [
    resolve(moduleDir, '../../locales'),
    resolve(moduleDir, '../../../locales'),
    resolve(moduleDir, '../../../../../locales'),
  ];
  for (const candidate of candidates) {
    if (directoryExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Locales directory not found. Tried: ${candidates.join(', ')}`,
  );
}

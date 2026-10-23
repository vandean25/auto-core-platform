import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveLocalesRoot } from './locales-root.js';

describe('resolveLocalesRoot', () => {
  it('prefers dist/locales when running from a dist/common/i18n layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'locales-root-dist-'));
    const distLocales = join(root, 'dist', 'locales');
    mkdirSync(distLocales, { recursive: true });
    const moduleDir = join(root, 'dist', 'common', 'i18n');
    mkdirSync(moduleDir, { recursive: true });

    const resolved = resolveLocalesRoot(moduleDir, (path) => path === distLocales);

    expect(resolved).toBe(distLocales);
  });

  it('falls back to repo-root locales from a src/common/i18n layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'locales-root-src-'));
    const repoLocales = join(root, 'locales');
    mkdirSync(repoLocales, { recursive: true });
    const moduleDir = join(root, 'apps', 'core-api', 'src', 'common', 'i18n');
    mkdirSync(moduleDir, { recursive: true });

    const resolved = resolveLocalesRoot(moduleDir, (path) => {
      return path === repoLocales;
    });

    expect(resolved).toBe(repoLocales);
  });

  it('throws listing every candidate when no locales directory exists', () => {
    const moduleDir = join(tmpdir(), 'missing-locales-module');
    let message = '';

    try {
      resolveLocalesRoot(moduleDir, () => false);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/Locales directory not found/);
    expect(message).toContain(resolve(moduleDir, '../../locales'));
    expect(message).toContain(resolve(moduleDir, '../../../locales'));
    expect(message).toContain(resolve(moduleDir, '../../../../../locales'));
  });
});

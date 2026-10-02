import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MANIFEST_RELATIVE = '.vite/manifest.json';

/**
 * @param {Record<string, import('./verify-build-chunks-lib.mjs').ManifestEntry>} manifest
 */
export function collectDynamicImportChunkFiles(manifest) {
  const files = new Set();

  for (const entry of Object.values(manifest)) {
    if (entry.isDynamicEntry && entry.file) {
      files.add(entry.file);
    }
  }

  for (const entry of Object.values(manifest)) {
    if (!entry.dynamicImports) {
      continue;
    }
    for (const importKey of entry.dynamicImports) {
      const target = manifest[importKey];
      if (target?.file) {
        files.add(target.file);
      } else {
        files.add(`(unresolved manifest key: ${importKey})`);
      }
    }
  }

  return files;
}

/**
 * @param {string} indexHtml
 * @returns {string[]} site-root paths like `/assets/index.js` (leading slash preserved)
 */
export function parseIndexHtmlReferencedPaths(indexHtml) {
  const paths = new Set();

  for (const match of indexHtml.matchAll(
    /<script[^>]*type="module"[^>]*src="([^"]+)"/gi,
  )) {
    paths.add(match[1]);
  }

  for (const match of indexHtml.matchAll(
    /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/gi,
  )) {
    paths.add(match[1]);
  }

  for (const match of indexHtml.matchAll(
    /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi,
  )) {
    paths.add(match[1]);
  }

  return [...paths];
}

function sitePathToDistRelative(sitePath) {
  const normalized = sitePath.startsWith('/') ? sitePath.slice(1) : sitePath;
  return normalized;
}

function isJsOrCss(relativePath) {
  return relativePath.endsWith('.js') || relativePath.endsWith('.css');
}

/**
 * @typedef {{ file?: string, isDynamicEntry?: boolean, dynamicImports?: string[] }} ManifestEntry
 */

/**
 * @param {{ distDir: string, manifestRelative?: string, readManifest?: () => Record<string, ManifestEntry>, readIndexHtml?: () => string }} options
 */
export function verifyBuildChunks(options) {
  const distDir = path.resolve(options.distDir);
  const manifestRelative = options.manifestRelative ?? DEFAULT_MANIFEST_RELATIVE;
  const manifestPath = path.join(distDir, manifestRelative);
  const indexPath = path.join(distDir, 'index.html');

  const problems = [];

  if (!fs.existsSync(distDir)) {
    throw new Error(`dist directory does not exist: ${distDir}`);
  }

  let manifest;
  try {
    const raw =
      options.readManifest?.() ??
      JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest = raw;
  } catch (error) {
    throw new Error(
      `Could not read Vite manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let indexHtml;
  try {
    indexHtml =
      options.readIndexHtml?.() ?? fs.readFileSync(indexPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read index.html at ${indexPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const dynamicFiles = collectDynamicImportChunkFiles(manifest);
  for (const file of dynamicFiles) {
    if (file.startsWith('(unresolved')) {
      problems.push(`dynamic import ${file}`);
      continue;
    }
    const absolute = path.join(distDir, file);
    if (!fs.existsSync(absolute)) {
      problems.push(`missing dynamic-import chunk: ${file}`);
    } else if (isJsOrCss(file) && fs.statSync(absolute).size === 0) {
      problems.push(`empty dynamic-import chunk: ${file}`);
    }
  }

  const indexPaths = parseIndexHtmlReferencedPaths(indexHtml);
  for (const sitePath of indexPaths) {
    const relative = sitePathToDistRelative(sitePath);
    const absolute = path.join(distDir, relative);
    if (!fs.existsSync(absolute)) {
      problems.push(`index.html references missing file: ${sitePath}`);
    } else if (isJsOrCss(relative) && fs.statSync(absolute).size === 0) {
      problems.push(`index.html references empty file: ${sitePath}`);
    }
  }

  if (problems.length > 0) {
    const message = [
      'Build chunk verification failed:',
      ...problems.map((line) => `  - ${line}`),
    ].join('\n');
    throw new Error(message);
  }

  return {
    distDir,
    dynamicChunkCount: dynamicFiles.size,
    indexReferenceCount: indexPaths.length,
  };
}

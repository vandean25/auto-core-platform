import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MANIFEST_RELATIVE = '.vite/manifest.json';

/**
 * @typedef {{
 *   file?: string,
 *   isDynamicEntry?: boolean,
 *   isEntry?: boolean,
 *   dynamicImports?: string[],
 *   imports?: string[],
 *   css?: string[],
 *   assets?: string[],
 * }} ManifestEntry
 */

/**
 * @param {Record<string, ManifestEntry>} manifest
 * @returns {{ files: Set<string>, unresolved: Set<string> }}
 */
export function collectDynamicImportChunkFiles(manifest) {
  const files = new Set();
  const unresolved = new Set();
  const visited = new Set();

  const visit = (key) => {
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const entry = manifest[key];
    if (!entry?.file) {
      unresolved.add(key);
      return;
    }

    files.add(entry.file);
    for (const css of entry.css ?? []) {
      files.add(css);
    }
    for (const asset of entry.assets ?? []) {
      files.add(asset);
    }
    for (const child of entry.imports ?? []) {
      visit(child);
    }
  };

  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.isDynamicEntry) {
      visit(key);
    }
    for (const dynamicKey of entry.dynamicImports ?? []) {
      visit(dynamicKey);
    }
  }

  return { files, unresolved };
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

  const { files: dynamicFiles, unresolved } = collectDynamicImportChunkFiles(manifest);
  for (const key of unresolved) {
    problems.push(`dynamic import references unknown manifest key: ${key}`);
  }
  for (const file of dynamicFiles) {
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
    unresolvedDynamicKeyCount: unresolved.size,
    indexReferenceCount: indexPaths.length,
  };
}

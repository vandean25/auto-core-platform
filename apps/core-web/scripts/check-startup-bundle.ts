import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** Recorded on origin/main (2713f70) via `vite build --mode production` manifest analysis. */
export const ORIGIN_MAIN_STARTUP_BASELINE = {
  startupFiles: 44,
  startupRawBytes: 1_749_448,
  startupGzipBytes: 535_224,
  entryRawBytes: 1_134_785,
  entryGzipBytes: 348_005,
} as const

export type StartupBundleMetrics = {
  startupFiles: number
  startupAssetFiles: number
  startupRawBytes: number
  startupGzipBytes: number
  entryFile: string
  entryRawBytes: number
  entryGzipBytes: number
}

type ManifestEntry = {
  file?: string
  isEntry?: boolean
  imports?: string[]
  css?: string[]
}

export function measureStartupBundle(distDir: string): StartupBundleMetrics {
  const manifestPath = path.join(distDir, '.vite', 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, ManifestEntry>
  const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry)
  if (!entryKey) {
    throw new Error(`No entry chunk found in ${manifestPath}`)
  }

  const visited = new Set<string>()
  const files = new Set<string>()

  function walk(key: string) {
    if (visited.has(key)) return
    visited.add(key)
    const item = manifest[key]
    if (!item) return
    if (item.file) files.add(item.file)
    for (const css of item.css ?? []) files.add(css)
    for (const imp of item.imports ?? []) walk(imp)
  }

  walk(entryKey)

  let startupRawBytes = 0
  let startupGzipBytes = 0
  for (const relPath of files) {
    const buf = fs.readFileSync(path.join(distDir, relPath))
    startupRawBytes += buf.length
    startupGzipBytes += zlib.gzipSync(buf).length
  }

  const entryFile = manifest[entryKey].file ?? ''
  const entryBuf = fs.readFileSync(path.join(distDir, entryFile))

  return {
    startupFiles: files.size + 1, // + index.html
    startupAssetFiles: files.size,
    startupRawBytes,
    startupGzipBytes,
    entryFile,
    entryRawBytes: entryBuf.length,
    entryGzipBytes: zlib.gzipSync(entryBuf).length,
  }
}

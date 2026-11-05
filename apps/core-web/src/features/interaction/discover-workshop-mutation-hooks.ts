import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WORKSHOP_MUTATION_HOOKS_EXCLUDED_FROM_PILOT,
  WORKSHOP_MUTATION_SOURCE_FILES,
} from './workshop-mutation-scope'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')

export type DiscoveredWorkshopMutationHook = {
  owningHook: string
  sourceFile: string
}

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8')
}

function sliceExportFunctionBlock(source: string, startIndex: number): string {
  const tail = source.slice(startIndex)
  const openBrace = tail.indexOf('{')
  if (openBrace === -1) return tail
  let depth = 0
  for (let i = openBrace; i < tail.length; i += 1) {
    const char = tail[i]
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return tail.slice(0, i + 1)
    }
  }
  return tail
}

function sliceExportBlock(source: string, startIndex: number): string {
  return sliceExportFunctionBlock(source, startIndex)
}

function discoverUseMutationHooks(source: string, relativePath: string): string[] {
  const hooks: string[] = []
  const patterns = [
    /export\s+(?:async\s+)?function\s+(use[A-Za-z0-9_]+)\s*\(/g,
    /export\s+const\s+(use[A-Za-z0-9_]+)\s*=\s*(?:\([^)]*\)|[^=]*)\s*=>/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const owningHook = match[1]
      if (!owningHook || WORKSHOP_MUTATION_HOOKS_EXCLUDED_FROM_PILOT.has(owningHook)) {
        continue
      }
      const block = sliceExportBlock(source, match.index ?? 0)
      if (/\buseMutation\s*[<(]/.test(block)) {
        hooks.push(owningHook)
      }
    }
  }

  if (
    relativePath.endsWith('WorkshopReadyEmailNotice.tsx') &&
    /\buseMutation\s*\(/.test(source)
  ) {
    hooks.push('WorkshopReadyEmailNotice')
  }

  return [...new Set(hooks)]
}

export function discoverWorkshopMutationHooks(): DiscoveredWorkshopMutationHook[] {
  const discovered: DiscoveredWorkshopMutationHook[] = []
  for (const sourceFile of WORKSHOP_MUTATION_SOURCE_FILES) {
    const source = readSource(sourceFile)
    for (const owningHook of discoverUseMutationHooks(source, sourceFile)) {
      discovered.push({ owningHook, sourceFile })
    }
  }
  return discovered.sort((a, b) =>
    a.owningHook === b.owningHook
      ? a.sourceFile.localeCompare(b.sourceFile)
      : a.owningHook.localeCompare(b.owningHook),
  )
}

export function inventoryEntryKey(operationId: string, owningHook: string): string {
  return `${operationId}\u0000${owningHook}`
}

function getHookSourceBlock(source: string, owningHook: string): string | undefined {
  if (owningHook === 'WorkshopReadyEmailNotice') {
    return source
  }
  const fnPattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${owningHook}\\s*\\(`)
  const constPattern = new RegExp(`export\\s+const\\s+${owningHook}\\s*=`)
  const fnMatch = fnPattern.exec(source)
  const constMatch = constPattern.exec(source)
  const start = fnMatch?.index ?? constMatch?.index
  if (start === undefined) return undefined
  return sliceExportBlock(source, start)
}

function optimisticSpreadDeclaresMutationKey(source: string, hookBlock: string): boolean {
  const useMutationBlock = hookBlock.match(/useMutation\s*\(\s*\{([\s\S]*?)\}\s*[,)]/)?.[1]
  if (!useMutationBlock) return false
  for (const spreadName of useMutationBlock.matchAll(/\.\.\.([A-Za-z0-9_]+)/g)) {
    const name = spreadName[1]
    if (!name) continue
    const spreadConst = source.match(
      new RegExp(`const\\s+${name}\\s*=\\s*optimisticMutationOptions[\\s\\S]*?\\{([\\s\\S]*?)\\}\\s*\\)`),
    )?.[1]
    if (spreadConst && /\bmutationKey\s*:/.test(spreadConst)) {
      return true
    }
    const mechanicSpread = source.match(
      new RegExp(`const\\s+${name}\\s*=\\s*mechanicQueueLifecycleOptimistic`),
    )
    if (mechanicSpread) {
      return true
    }
  }
  return false
}

/** True when the hook's useMutation options include an explicit mutationKey property. */
export function hookDeclaresMutationKey(owningHook: string, sourceFile: string): boolean {
  const source = readSource(sourceFile)
  const block = getHookSourceBlock(source, owningHook)
  if (!block) return false
  if (/\bmutationKey\s*:/.test(block)) return true
  return optimisticSpreadDeclaresMutationKey(source, block)
}

export function discoverWorkshopHooksMissingMutationKey(
  hooks: DiscoveredWorkshopMutationHook[] = discoverWorkshopMutationHooks(),
): string[] {
  return hooks
    .filter(({ owningHook, sourceFile }) => !hookDeclaresMutationKey(owningHook, sourceFile))
    .map(({ owningHook }) => owningHook)
    .sort()
}

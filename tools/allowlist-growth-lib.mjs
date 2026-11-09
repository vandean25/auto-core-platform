import { findBaselineGrowth } from './interaction-baselines-lib.mjs'

/** Ratcheted allowlists outside interaction guard baseline JSON files (AUT-924). */
export const GROWTH_ALLOWLISTS = [
  {
    id: 'intent-prefetch-exceptions',
    file: 'apps/core-web/src/features/interaction/intent-prefetch-exceptions.json',
    identities(text) {
      return JSON.parse(text).exceptions.map((entry) => entry.file)
    },
  },
  {
    id: 'i18n-check-manifest',
    file: 'tools/i18n-check-manifest.json',
    identities(text) {
      const document = JSON.parse(text)
      return [
        ...document.treatNamespaceAsUsed,
        ...document.usedKeyPrefixes,
        ...(document.usedKeys ?? []),
      ]
    },
  },
  {
    id: 'system-prisma-delegates',
    file: 'apps/core-api/src/prisma/system-prisma.types.ts',
    identities: extractSystemPrismaDelegates,
  },
  {
    id: 'system-prisma-service-getters',
    file: 'apps/core-api/src/prisma/system-prisma.service.ts',
    identities: extractSystemPrismaGetters,
  },
  {
    id: 'recipient-allowlist-exports',
    file: 'apps/core-api/src/notifications/email/recipient-allowlist.ts',
    identities: extractRecipientAllowlistExports,
  },
]

export function extractSystemPrismaDelegates(source) {
  const match = source.match(/export const SYSTEM_PRISMA_MODEL_DELEGATES = \[([\s\S]*?)\] as const/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((part) => part[1]).sort()
}

export function extractSystemPrismaGetters(source) {
  return [...source.matchAll(/^\s+get (\w+)\(\)/gm)].map((part) => part[1]).sort()
}

export function extractRecipientAllowlistExports(source) {
  return [...source.matchAll(/^export function (\w+)/gm)].map((part) => part[1]).sort()
}

export function checkAllowlistGrowth({ readBase, readHead, allowlists = GROWTH_ALLOWLISTS }) {
  const results = []
  for (const { id, file, identities } of allowlists) {
    const headText = readHead(file)
    const baseText = readBase(file)
    if (headText === undefined && baseText === undefined) {
      results.push({ id, file, status: 'ok', growth: [] })
      continue
    }
    if (headText === undefined) {
      results.push({ id, file, status: 'removed', growth: [] })
      continue
    }
    if (baseText === undefined) {
      const growth = identities(headText)
      results.push({ id, file, status: growth.length > 0 ? 'grew' : 'activated', growth: [] })
      continue
    }
    const growth = findBaselineGrowth(identities(baseText), identities(headText))
    results.push({ id, file, status: growth.length > 0 ? 'grew' : 'ok', growth })
  }
  return results
}

import { findBaselineGrowth } from './interaction-baselines-lib.mjs'
import { extractRecipientAllowlistExports } from './recipient-allowlist-exports.mjs'

export const SYSTEM_PRISMA_DELEGATES_PATTERN =
  /export const SYSTEM_PRISMA_MODEL_DELEGATES = \[([\s\S]*?)\] as const/

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
  const match = source.match(SYSTEM_PRISMA_DELEGATES_PATTERN)
  if (!match) return null
  return [...match[1].matchAll(/'([^']+)'/g)].map((part) => part[1]).sort()
}

export function extractSystemPrismaGetters(source) {
  if (!source.includes('export class SystemPrismaService')) return null
  if (!/^\s+get \w+\(\)/m.test(source)) return null
  return [...source.matchAll(/^\s+get (\w+)\(\)/gm)].map((part) => part[1]).sort()
}

export { extractRecipientAllowlistExports }

function resolveIdentities(identities, text) {
  const values = identities(text)
  if (values === null) return { values: [], unparseable: true }
  return { values, unparseable: false }
}

function compareAllowlistEntry({ id, file, identities, readBase, readHead }) {
  const headText = readHead(file)
  const baseText = readBase(file)
  if (headText === undefined && baseText === undefined) return { id, file, status: 'ok', growth: [] }
  if (headText === undefined) return { id, file, status: 'removed', growth: [] }
  if (baseText === undefined) return compareNewAllowlistFile({ id, file, identities, headText })
  return compareExistingAllowlistFile({ id, file, identities, baseText, headText })
}

function compareNewAllowlistFile({ id, file, identities, headText }) {
  const headList = resolveIdentities(identities, headText)
  if (headList.unparseable) return { id, file, status: 'unparseable', growth: [] }
  return { id, file, status: headList.values.length > 0 ? 'grew' : 'activated', growth: [] }
}

function compareExistingAllowlistFile({ id, file, identities, baseText, headText }) {
  const baseList = resolveIdentities(identities, baseText)
  const headList = resolveIdentities(identities, headText)
  if (baseList.unparseable || headList.unparseable) {
    return { id, file, status: 'unparseable', growth: [] }
  }
  const growth = findBaselineGrowth(baseList.values, headList.values)
  return { id, file, status: growth.length > 0 ? 'grew' : 'ok', growth }
}

export function checkAllowlistGrowth({ readBase, readHead, allowlists = GROWTH_ALLOWLISTS }) {
  return allowlists.map((entry) => compareAllowlistEntry({ ...entry, readBase, readHead }))
}

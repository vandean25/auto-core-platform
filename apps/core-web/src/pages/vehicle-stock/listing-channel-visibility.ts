import type { EffectiveCapabilities } from '@/api/auth-session'

/** Willhaben channels are shown only when the willhaben export capability is on. */
export function visibleListingChannels<T extends { platform: string }>(
  channels: T[],
  capabilities: EffectiveCapabilities | null | undefined,
): T[] {
  if (capabilities?.willhabenExport === true) return channels
  return channels.filter((channel) => channel.platform !== 'WILLHABEN')
}

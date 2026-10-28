import type { components } from '@/api/generated/openapi'

type LegacyNumbersProps = {
  legacyIds?: components['schemas']['LegacyIdDto'][]
  label: string
  sourceLabel: (source: string) => string
}

export function LegacyNumbers({ legacyIds, label, sourceLabel }: LegacyNumbersProps) {
  if (!legacyIds?.length) return null

  return (
    <dl className='space-y-2'>
      {legacyIds.map(({ source_system, external_id }) => (
        <div key={JSON.stringify([source_system, external_id])}>
          <dt className='text-xs text-muted-foreground break-all'>
            {legacyIds.length > 1 ? sourceLabel(source_system) : label}
          </dt>
          <dd className='text-sm font-medium tabular-nums break-all'>{external_id}</dd>
        </div>
      ))}
    </dl>
  )
}

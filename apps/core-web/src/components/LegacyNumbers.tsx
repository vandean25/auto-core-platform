import type { components } from '@/api/generated/openapi'

type LegacyNumbersProps = {
  legacyIds?: components['schemas']['LegacyIdDto'][]
  sourceLabel: (source: string) => string
}

export function LegacyNumbers({ legacyIds, sourceLabel }: LegacyNumbersProps) {
  if (!legacyIds?.length) return null

  return (
    <dl className='space-y-2'>
      {legacyIds.map(({ source_system, external_id }) => (
        <div key={JSON.stringify([source_system, external_id])}>
          <dt className='text-xs text-muted-foreground break-all'>
            {sourceLabel(source_system)}
          </dt>
          <dd className='text-sm font-medium tabular-nums break-all'>{external_id}</dd>
        </div>
      ))}
    </dl>
  )
}

import { useTranslation } from 'react-i18next'

import type { AdminSiteRecord } from '@/api/site-admin'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

type SitesTableProps = {
  sites: AdminSiteRecord[]
  selectedSiteId: string | null
  onSelect: (siteId: string) => void
}

/** The sites of the tenant: a table on larger screens, one tappable row per site on a phone (five columns do not fit). */
export function SitesTable({ sites, selectedSiteId, onSelect }: SitesTableProps) {
  const { t } = useTranslation('settings')
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <ul className="divide-y rounded-lg border bg-white shadow-sm">
        {sites.map((site) => (
          <li key={site.id}>
            <button
              type="button"
              aria-pressed={site.id === selectedSiteId}
              onClick={() => onSelect(site.id)}
              className={cn(
                'flex min-h-11 w-full items-start justify-between gap-3 p-3 text-left',
                site.id === selectedSiteId && 'bg-slate-50',
              )}
            >
              <span className="min-w-0 space-y-1">
                <span className="block break-words font-medium">
                  <span className="mr-2 font-mono text-sm text-slate-500">{site.code}</span>
                  {site.name}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {site.legal_entity?.name ?? '—'} · {t('sites.columns.members')}: {site._count?.memberships ?? 0}
                </span>
              </span>
              <StatusBadge status={site.is_active ? 'ACTIVE' : 'INACTIVE'} />
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sites.columns.code')}</TableHead>
            <TableHead>{t('sites.columns.name')}</TableHead>
            <TableHead>{t('sites.columns.legalEntity')}</TableHead>
            <TableHead>{t('sites.columns.status')}</TableHead>
            <TableHead>{t('sites.columns.members')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.map((site) => (
            <TableRow
              key={site.id}
              data-state={site.id === selectedSiteId ? 'selected' : undefined}
              className={site.id === selectedSiteId ? 'bg-slate-50' : undefined}
              onClick={() => onSelect(site.id)}
            >
              <TableCell className="font-mono text-sm">{site.code}</TableCell>
              <TableCell className="font-medium">{site.name}</TableCell>
              <TableCell>{site.legal_entity?.name ?? '—'}</TableCell>
              <TableCell>
                <StatusBadge status={site.is_active ? 'ACTIVE' : 'INACTIVE'} />
              </TableCell>
              <TableCell>{site._count?.memberships ?? 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

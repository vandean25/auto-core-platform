import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { VehiclePartyResponse } from '@/api/vehicles'
import { formatIsoDateOnly } from '@/lib/format'
import { formatPartyCustomerName, formatVehiclePartyRole } from './vehicle-party-model'

type VehiclePartyTableProps = {
  parties: VehiclePartyResponse[]
  emptyText: string
  /** Passed only when the caller may end parties; ended rows never get the action. */
  onEnd?: (partyId: string) => void
  endingPartyId?: string
}

export function VehiclePartyTable({ parties, emptyText, onEnd, endingPartyId }: VehiclePartyTableProps) {
  const { t } = useTranslation('vehicles')
  const showActions = Boolean(onEnd)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('parties.columns.role')}</TableHead>
          <TableHead>{t('parties.columns.customer')}</TableHead>
          <TableHead>{t('parties.columns.validity')}</TableHead>
          {showActions ? <TableHead className='text-right' /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {parties.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showActions ? 4 : 3} className='text-muted-foreground'>
              {emptyText}
            </TableCell>
          </TableRow>
        ) : (
          parties.map((party) => (
            <TableRow key={party.id} className={party.is_active ? undefined : 'text-muted-foreground'}>
              <TableCell>{formatVehiclePartyRole(party.role)}</TableCell>
              <TableCell>
                <Link className='font-medium hover:underline' to={`/customers/${party.customer.id}`}>
                  {formatPartyCustomerName(party.customer)}
                </Link>
              </TableCell>
              <TableCell>
                {t('parties.validRange', {
                  from: formatIsoDateOnly(party.valid_from),
                  to: party.valid_to ? formatIsoDateOnly(party.valid_to) : t('parties.validOpen'),
                })}
              </TableCell>
              {showActions ? (
                <TableCell className='text-right'>
                  {party.is_active ? (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={endingPartyId === party.id}
                      onClick={() => onEnd?.(party.id)}
                    >
                      {t('parties.end')}
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

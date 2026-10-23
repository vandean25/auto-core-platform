import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import type { Customer } from '@/api/types'
import { useEndVehicleParty, useVehicleParties } from '@/api/vehicles'
import { useAuthSession } from '@/api/auth-session'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { getErrorMessage } from '@/lib/error-utils'
import { AddVehiclePartyDialog } from './AddVehiclePartyDialog'
import { VehiclePartyTable } from './VehiclePartyTable'
import {
  canManageVehicleParties,
  resolveMainContact,
  splitVehicleParties,
  type MainContact,
} from './vehicle-party-model'

function MainContactLine({ contact, partiesLoaded }: { contact: MainContact | null; partiesLoaded: boolean }) {
  const { t } = useTranslation('vehicles')
  const showNoOwnerHint = partiesLoaded && contact !== null && !contact.fromOwnerParty

  return (
    <div className='space-y-1 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground'>{t('parties.mainContact')}</span>
        {contact ? (
          <Link className='font-medium hover:underline' to={`/customers/${contact.id}`}>
            {contact.name}
          </Link>
        ) : null}
      </div>
      {showNoOwnerHint ? <p className='text-xs text-muted-foreground'>{t('parties.noOwnerHint')}</p> : null}
    </div>
  )
}

type VehiclePartiesSectionProps = {
  vehicleId: string
  vehicleCustomer: Customer | null
}

export function VehiclePartiesSection({ vehicleId, vehicleCustomer }: VehiclePartiesSectionProps) {
  const { t } = useTranslation('vehicles')
  const [addOpen, setAddOpen] = useState(false)
  const partiesQuery = useVehicleParties(vehicleId)
  const endParty = useEndVehicleParty(vehicleId)
  const sessionQuery = useAuthSession()
  const canManage = canManageVehicleParties(sessionQuery.data?.activeRole)

  const parties = partiesQuery.data?.data ?? []
  const { active, history } = splitVehicleParties(parties)
  const mainContact = resolveMainContact(parties, vehicleCustomer)

  const handleEnd = async (partyId: string) => {
    try {
      await endParty.mutateAsync(partyId)
      toast.success(t('parties.ended'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('parties.endFailed')))
    }
  }

  return (
    <Card>
      <CardHeader className='flex-row items-start justify-between gap-2 space-y-0'>
        <div className='space-y-1.5'>
          <CardTitle>{t('parties.title')}</CardTitle>
          <CardDescription>{t('parties.subtitle')}</CardDescription>
        </div>
        {canManage ? (
          <Button size='sm' variant='outline' onClick={() => setAddOpen(true)}>
            <Plus className='mr-2 h-4 w-4' />
            {t('parties.add')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-4'>
        <MainContactLine contact={mainContact} partiesLoaded={partiesQuery.isSuccess} />
        {partiesQuery.isError ? (
          <p role='alert' className='text-sm text-destructive'>
            {t('parties.loadFailed')}
          </p>
        ) : null}
        <VehiclePartyTable
          parties={active}
          emptyText={t('parties.empty')}
          onEnd={canManage ? (partyId) => void handleEnd(partyId) : undefined}
          endingPartyId={endParty.isPending ? endParty.variables : undefined}
        />
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm' className='px-0'>
              {t('parties.historyToggle', { count: history.length })}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className='pt-2'>
            <VehiclePartyTable parties={history} emptyText={t('parties.historyEmpty')} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
      {canManage ? (
        <AddVehiclePartyDialog vehicleId={vehicleId} open={addOpen} onOpenChange={setAddOpen} />
      ) : null}
    </Card>
  )
}

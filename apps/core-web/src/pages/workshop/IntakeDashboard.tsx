import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useIntakeDashboardPrefill } from './use-intake-dashboard-prefill'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useWorkshopSearch } from '@/api/workshop'
import { QuickRegisterDialog } from '@/components/workshop/QuickRegisterDialog'
import { StartServiceDialog } from '@/components/workshop/StartServiceDialog'
import { Plus, Wrench } from 'lucide-react'

export function IntakeDashboard() {
  const { t } = useTranslation('workshop')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useWorkshopSearch(debouncedSearch)
  const [isRegisterOpen, setIsRegisterOpen] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<{ id: string, description: string, customerId: string } | null>(null)

  useIntakeDashboardPrefill({ search, selectedVehicle, setSearch, setSelectedVehicle })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('intakeDashboard.title')}</h1>
        </div>
        <Button onClick={() => setIsRegisterOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t('intakeDashboard.quickRegister')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('intakeDashboard.searchTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Input
              placeholder={t('intakeDashboard.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
            {isLoading && <span className="flex items-center text-sm text-muted-foreground">{t('intakeDashboard.searching')}</span>}
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="grid gap-6 md:grid-cols-2">
          {data.data.vehicles.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{t('intakeDashboard.vehicles')}</h2>
              {data.data.vehicles.map(vehicle => (
                <Card key={vehicle.id} className="hover:bg-slate-50 transition-colors">
                  <CardContent className="p-4 flex justify-between items-center">
                    <div>
                      <div className="font-bold">{vehicle.year} {vehicle.make} {vehicle.model}</div>
                      <div className="text-sm text-muted-foreground">
                        {t('intakeDashboard.vehicleMeta', { vin: vehicle.vin, plate: vehicle.plate })}
                      </div>
                      {vehicle.customer && (
                        <div className="text-sm mt-1">
                          {t('intakeDashboard.owner', { name: `${vehicle.customer.first_name} ${vehicle.customer.last_name}` })}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => vehicle.customer && setSelectedVehicle({
                        id: vehicle.id,
                        description: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                        customerId: vehicle.customer.id
                      })}
                      disabled={!vehicle.customer}
                    >
                      <Wrench className="mr-2 h-3 w-3" /> {t('intakeDashboard.startService')}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {data.data.customers.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{t('intakeDashboard.customers')}</h2>
              {data.data.customers.map(customer => (
                <Card key={customer.id} className="hover:bg-slate-50 transition-colors">
                  <CardContent className="p-4">
                    <div className="font-bold">{customer.first_name} {customer.last_name}</div>
                    <div className="text-sm text-muted-foreground">{customer.email}</div>
                    {customer.vehicles && customer.vehicles.length > 0 && (
                      <div className="mt-2 pl-2 border-l-2 space-y-2">
                        <div className="text-sm font-medium">{t('intakeDashboard.vehiclesLabel')}</div>
                        {customer.vehicles.map(v => (
                          <div key={v.id} className="text-sm flex justify-between items-center bg-white p-2 rounded border">
                            <span>{v.make} {v.model} ({v.plate})</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              onClick={() => setSelectedVehicle({
                                id: v.id,
                                description: `${v.make} ${v.model}`,
                                customerId: customer.id
                              })}
                            >
                              {t('intakeDashboard.service')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {data && debouncedSearch.length >= 2 && data.data.vehicles.length === 0 && data.data.customers.length === 0 && !isLoading && (
        <div className="text-center p-8 border border-dashed rounded-lg text-muted-foreground">
          <p className="mb-2">{t('intakeDashboard.noResults')}</p>
          <Button variant="outline" onClick={() => setIsRegisterOpen(true)}>{t('intakeDashboard.registerNew')}</Button>
        </div>
      )}

      <QuickRegisterDialog
        open={isRegisterOpen}
        onOpenChange={setIsRegisterOpen}
        defaultVin={search.length === 17 ? search : undefined}
      />

      {selectedVehicle && (
        <StartServiceDialog
          open={!!selectedVehicle}
          onOpenChange={(open) => !open && setSelectedVehicle(null)}
          customerId={selectedVehicle.customerId}
          vehicleId={selectedVehicle.id}
          vehicleDescription={selectedVehicle.description}
        />
      )}
    </div>
  )
}

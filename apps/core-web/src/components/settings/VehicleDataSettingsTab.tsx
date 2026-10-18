import * as React from 'react'
import { Loader2, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAuthSession } from '@/api/auth-session'
import { flattenLaborCategories, useLaborCategories } from '@/api/labor'
import {
  useCatalogProviderSettings,
  useUpdateCatalogProviderSettings,
} from '@/api/useCatalogProviderSettings'
import type { CatalogProviderSettings } from '@/api/types'
import { BrandMultiSelect } from '@/components/BrandMultiSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CATALOG_ADAPTER_OPTIONS,
  OEM_CONCERN_CODES,
  OEM_CONCERN_LABELS,
  type OemConcernCode,
} from '@/constants/catalog-adapters'
import { getErrorMessage } from '@/lib/error-utils'

type ConcernFormState = Record<OemConcernCode, number[]>

type SettingsFormState = {
  defaultIdentityAdapterId: string
  defaultPartsAftermarketAdapterId: string
  defaultLaborAftermarketAdapterId: string
  defaultLaborCategoryId: string
  awMinutes: number
  oemConcerns: ConcernFormState
}

const EMPTY_CONCERN_STATE: ConcernFormState = {
  BMW: [],
  MERCEDES: [],
  STELLANTIS: [],
}

function canManageVehicleData(activeRole?: string | null): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}

function settingsToFormState(settings: CatalogProviderSettings): SettingsFormState {
  const oemConcerns = { ...EMPTY_CONCERN_STATE }

  for (const concern of settings.oemConcerns) {
    const code = concern.code as OemConcernCode
    if (OEM_CONCERN_CODES.includes(code)) {
      oemConcerns[code] = concern.memberMakes.map((make) => make.id)
    }
  }

  return {
    defaultIdentityAdapterId: settings.defaultIdentityAdapterId ?? '',
    defaultPartsAftermarketAdapterId: settings.defaultPartsAftermarketAdapterId ?? '',
    defaultLaborAftermarketAdapterId: settings.defaultLaborAftermarketAdapterId ?? '',
    defaultLaborCategoryId: settings.defaultLaborCategoryId ?? '',
    awMinutes: settings.awMinutes,
    oemConcerns,
  }
}

function AdapterSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className='space-y-2'>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || '__none__'}
        disabled={disabled}
        onValueChange={(nextValue) => onChange(nextValue === '__none__' ? '' : nextValue)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={t('vehicleData.catalog.notConfigured')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='__none__'>{t('vehicleData.catalog.notConfigured')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function VehicleDataSettingsTab() {
  const { t } = useTranslation('settings')
  const sessionQuery = useAuthSession()
  const canManage = canManageVehicleData(sessionQuery.data?.activeRole)

  const {
    data: settings,
    isLoading: isLoadingSettings,
    isError: isSettingsError,
  } = useCatalogProviderSettings({ enabled: canManage })
  const { data: laborCategoriesData, isLoading: isLoadingLaborCategories } = useLaborCategories()
  const updateMutation = useUpdateCatalogProviderSettings()

  const [formState, setFormState] = React.useState<SettingsFormState | null>(null)

  React.useEffect(() => {
    if (!settings || formState) return
    setFormState(settingsToFormState(settings))
  }, [formState, settings])

  const laborCategoryOptions = React.useMemo(
    () => flattenLaborCategories(laborCategoriesData),
    [laborCategoriesData],
  )

  const concernDetailsByCode = React.useMemo(() => {
    const map = new Map(settings?.oemConcerns.map((concern) => [concern.code, concern]))
    return map
  }, [settings?.oemConcerns])

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!formState || !canManage) return

    if (!Number.isInteger(formState.awMinutes) || formState.awMinutes < 1) {
      toast.error(t('vehicleData.toast.awMinutesInvalid'))
      return
    }

    const payload = {
      defaultIdentityAdapterId: formState.defaultIdentityAdapterId || null,
      defaultPartsAftermarketAdapterId: formState.defaultPartsAftermarketAdapterId || null,
      defaultLaborAftermarketAdapterId: formState.defaultLaborAftermarketAdapterId || null,
      defaultLaborCategoryId: formState.defaultLaborCategoryId || null,
      awMinutes: formState.awMinutes,
      oemConcerns: OEM_CONCERN_CODES.map((code) => ({
        code,
        memberBrandIds: formState.oemConcerns[code],
      })),
    }

    try {
      const saved = await updateMutation.mutateAsync(payload)
      setFormState(settingsToFormState(saved))
      toast.success(t('vehicleData.toast.saved'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('vehicleData.toast.saveFailed')))
    }
  }

  const updateConcernMakes = (code: OemConcernCode, memberBrandIds: number[]) => {
    setFormState((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        oemConcerns: {
          ...previous.oemConcerns,
          [code]: memberBrandIds,
        },
      }
    })
  }

  if (!canManage) {
    return (
      <p className='text-sm text-muted-foreground'>
        {t('vehicleData.noAccess')}
      </p>
    )
  }

  if (isSettingsError) {
    return (
      <p className='text-sm text-destructive'>
        {t('vehicleData.loadFailed')}
      </p>
    )
  }

  if (isLoadingSettings || isLoadingLaborCategories || !formState) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className='space-y-8'>
      <div className='p-6 bg-white border rounded-lg shadow-sm space-y-6'>
        <div>
          <h2 className='text-lg font-medium'>{t('vehicleData.catalog.title')}</h2>
          <p className='text-sm text-muted-foreground'>
            {t('vehicleData.catalog.description')}
          </p>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <AdapterSelect
            id='vehicle-identity-adapter'
            label={t('vehicleData.catalog.identityAdapter')}
            value={formState.defaultIdentityAdapterId}
            options={CATALOG_ADAPTER_OPTIONS.identity}
            disabled={!canManage}
            onChange={(value) => {
              setFormState((previous) =>
                previous ? { ...previous, defaultIdentityAdapterId: value } : previous,
              )
            }}
          />
          <AdapterSelect
            id='vehicle-parts-aftermarket-adapter'
            label={t('vehicleData.catalog.partsAdapter')}
            value={formState.defaultPartsAftermarketAdapterId}
            options={CATALOG_ADAPTER_OPTIONS.partsAftermarket}
            disabled={!canManage}
            onChange={(value) => {
              setFormState((previous) =>
                previous ? { ...previous, defaultPartsAftermarketAdapterId: value } : previous,
              )
            }}
          />
          <AdapterSelect
            id='vehicle-labor-aftermarket-adapter'
            label={t('vehicleData.catalog.laborAdapter')}
            value={formState.defaultLaborAftermarketAdapterId}
            options={CATALOG_ADAPTER_OPTIONS.laborAftermarket}
            disabled={!canManage}
            onChange={(value) => {
              setFormState((previous) =>
                previous ? { ...previous, defaultLaborAftermarketAdapterId: value } : previous,
              )
            }}
          />
          <div className='space-y-2'>
            <Label htmlFor='vehicle-default-labor-category'>{t('vehicleData.catalog.defaultLaborCategory')}</Label>
            <Select
              value={formState.defaultLaborCategoryId || '__none__'}
              disabled={!canManage}
              onValueChange={(value) => {
                setFormState((previous) =>
                  previous
                    ? {
                        ...previous,
                        defaultLaborCategoryId: value === '__none__' ? '' : value,
                      }
                    : previous,
                )
              }}
            >
              <SelectTrigger id='vehicle-default-labor-category'>
                <SelectValue placeholder={t('vehicleData.catalog.selectLaborCategory')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='__none__'>{t('vehicleData.catalog.notConfigured')}</SelectItem>
                {laborCategoryOptions.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='vehicle-aw-minutes'>{t('vehicleData.catalog.awMinutes')}</Label>
            <Input
              id='vehicle-aw-minutes'
              type='number'
              min={1}
              step={1}
              disabled={!canManage}
              value={formState.awMinutes}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                setFormState((previous) =>
                  previous
                    ? { ...previous, awMinutes: Number.isNaN(parsed) ? 0 : parsed }
                    : previous,
                )
              }}
            />
            <p className='text-sm text-muted-foreground'>
              {t('vehicleData.catalog.awMinutesHint')}
            </p>
          </div>
        </div>

        <div className='flex flex-wrap gap-2'>
          {settings?.hasIdentityCredential ? (
            <Badge variant='outline'>{t('vehicleData.catalog.badges.identity')}</Badge>
          ) : null}
          {settings?.hasPartsAftermarketCredential ? (
            <Badge variant='outline'>{t('vehicleData.catalog.badges.parts')}</Badge>
          ) : null}
          {settings?.hasLaborAftermarketCredential ? (
            <Badge variant='outline'>{t('vehicleData.catalog.badges.labor')}</Badge>
          ) : null}
        </div>
      </div>

      <div className='p-6 bg-white border rounded-lg shadow-sm space-y-6'>
        <div>
          <h2 className='text-lg font-medium'>{t('vehicleData.oemConcerns.title')}</h2>
          <p className='text-sm text-muted-foreground'>
            {t('vehicleData.oemConcerns.description')}
          </p>
        </div>

        <div className='space-y-6'>
          {OEM_CONCERN_CODES.map((code) => {
            const concern = concernDetailsByCode.get(code)

            return (
              <div key={code} className='space-y-3 border rounded-md p-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <h3 className='text-sm font-medium'>{OEM_CONCERN_LABELS[code]}</h3>
                  <div className='flex flex-wrap gap-2'>
                    {concern?.hasPartsCredential ? (
                      <Badge variant='secondary'>{t('vehicleData.oemConcerns.partsCredential')}</Badge>
                    ) : null}
                    {concern?.hasLaborCredential ? (
                      <Badge variant='secondary'>{t('vehicleData.oemConcerns.laborCredential')}</Badge>
                    ) : null}
                  </div>
                </div>
                <BrandMultiSelect
                  value={formState.oemConcerns[code]}
                  onChange={(memberBrandIds) => updateConcernMakes(code, memberBrandIds)}
                  vehicleMakesOnly
                  disabled={!canManage}
                  ariaLabel={t('vehicleData.oemConcerns.memberMakesAria', { concern: OEM_CONCERN_LABELS[code] })}
                />
              </div>
            )
          })}
        </div>
      </div>

      {canManage ? (
        <div className='flex justify-end'>
          <Button type='submit' disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Save className='mr-2 h-4 w-4' />
            )}
            {t('vehicleData.saveChanges')}
          </Button>
        </div>
      ) : null}
    </form>
  )
}

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { ImportEntityType, ImportMappingProfile } from '@/api/imports'
import { useCreateImportMappingProfile, useImportMappingProfiles } from '@/api/imports'
import { getErrorMessage } from '@/lib/error-utils'

import type { ImportEntityTypeUi } from './import-field-labels'
import { constrainMappingToCsvHeaders } from './import-mapping-suggest'

/** Loads and saves the mapping profiles of the selected entity and source system. */
export function useImportProfiles(params: {
  entityType: ImportEntityTypeUi
  sourceSystem: string
  csvHeaders: string[]
  mapping: Record<string, string>
  onMappingLoaded: (mapping: Record<string, string>) => void
  resetDryRun: () => void
}): {
  profiles: ImportMappingProfile[]
  profileName: string
  setProfileName: (name: string) => void
  loadProfile: (profileId: string) => void
  saveProfile: () => Promise<void>
  isSaving: boolean
} {
  const { t } = useTranslation(['settings', 'common'])
  const { data: profiles = [] } = useImportMappingProfiles(params.entityType, params.sourceSystem)
  const saveMutation = useCreateImportMappingProfile()
  const [profileName, setProfileName] = React.useState('')

  const loadProfile = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return
    params.onMappingLoaded(constrainMappingToCsvHeaders(profile.mapping, params.csvHeaders))
    params.resetDryRun()
    toast.success(t('dataImport.toast.profileLoaded'))
  }

  const saveProfile = async () => {
    const name = profileName.trim()
    if (!name) {
      toast.error(t('dataImport.toast.profileNameRequired'))
      return
    }
    try {
      await saveMutation.mutateAsync({
        entity_type: params.entityType as ImportEntityType,
        source_system: params.sourceSystem.trim(),
        name,
        mapping: params.mapping,
      })
      toast.success(t('dataImport.toast.profileSaved'))
      setProfileName('')
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.profileSaveFailed')))
    }
  }

  return {
    profiles,
    profileName,
    setProfileName,
    loadProfile,
    saveProfile,
    isSaving: saveMutation.isPending,
  }
}

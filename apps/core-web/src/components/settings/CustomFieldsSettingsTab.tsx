import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Download, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  downloadCustomFieldsCatalogueCsv,
  useCustomFieldDefinitions,
  useReorderCustomFieldDefinitions,
  useUpdateCustomFieldDefinition,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from '@/api/custom-fields'
import { getErrorMessage } from '@/lib/error-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { SettingsSectionHeading } from './SettingsSectionHeading'
import { SettingsLoadFailedState, SettingsTabLoadingState } from './settings-tab-shared'
import { CustomFieldDefinitionDialog } from './CustomFieldDefinitionDialog'

export function CustomFieldsSettingsTab() {
  const { t } = useTranslation(['settings', 'common'])
  const [entity, setEntity] = React.useState<CustomFieldEntity>('CUSTOMER')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<CustomFieldDefinition | null>(null)

  const {
    data: definitions = [],
    isLoading,
    isError,
    refetch,
  } = useCustomFieldDefinitions(entity, {
    includeArchived: true,
  })
  const updateMutation = useUpdateCustomFieldDefinition()
  const reorderMutation = useReorderCustomFieldDefinitions()

  const handleArchiveToggle = async (def: CustomFieldDefinition) => {
    try {
      await updateMutation.mutateAsync({
        id: def.id,
        data: { archived: !def.archived },
      })
      toast.success(
        def.archived
          ? t('settings:customFields.dialog.unarchived')
          : t('settings:customFields.dialog.archived'),
      )
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('settings:customFields.saveFailed')))
    }
  }

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= definitions.length) return
    const next = [...definitions]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    try {
      await reorderMutation.mutateAsync({
        entity,
        orderedIds: next.map((d) => d.id),
      })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('settings:customFields.saveFailed')))
    }
  }

  const handleExportCsv = async () => {
    try {
      const blob = await downloadCustomFieldsCatalogueCsv()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'custom-fields-catalogue.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('settings:customFields.exportFailed')))
    }
  }

  return (
    <div className="p-4 sm:p-6 bg-card border border-border rounded-lg shadow-sm space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SettingsSectionHeading
          title={t('settings:customFields.title')}
          description={t('settings:customFields.legalNotice')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExportCsv} className="max-sm:min-h-11">
            <Download className="mr-2 h-4 w-4" />
            {t('settings:customFields.exportCatalogue')}
          </Button>
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
            className="max-sm:min-h-11"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('settings:customFields.newField')}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {(['CUSTOMER', 'VEHICLE'] as const).map((item) => (
          <Button
            key={item}
            type="button"
            variant={entity === item ? 'default' : 'outline'}
            size="sm"
            className="max-sm:min-h-11 max-sm:min-w-11"
            onClick={() => setEntity(item)}
          >
            {t(`settings:customFields.entities.${item}`)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <SettingsTabLoadingState className="py-10" />
      ) : isError ? (
        <SettingsLoadFailedState
          message={t('settings:customFields.loadFailed')}
          onRetry={() => void refetch()}
        />
      ) : definitions.length === 0 ? (
        <Empty className="py-10">
          <EmptyDescription>{t('settings:customFields.empty')}</EmptyDescription>
        </Empty>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {definitions.map((def, index) => (
            <div
              key={def.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{def.label}</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {def.key}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {t(`settings:customFields.types.${def.type}`)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {def.personal_data
                      ? t('settings:customFields.personalDataBadge')
                      : t('settings:customFields.technicalBadge')}
                  </Badge>
                  {def.archived && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {t('settings:customFields.archivedBadge')}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{def.purpose}</p>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="max-sm:min-h-11 max-sm:min-w-11"
                  disabled={index === 0 || reorderMutation.isPending}
                  onClick={() => handleMove(index, -1)}
                  aria-label={t('settings:customFields.actions.moveUp')}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="max-sm:min-h-11 max-sm:min-w-11"
                  disabled={index === definitions.length - 1 || reorderMutation.isPending}
                  onClick={() => handleMove(index, 1)}
                  aria-label={t('settings:customFields.actions.moveDown')}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="max-sm:min-h-11 max-sm:min-w-11"
                  onClick={() => {
                    setEditing(def)
                    setDialogOpen(true)
                  }}
                  aria-label={t('settings:customFields.actions.edit')}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="max-sm:min-h-11 max-sm:min-w-11"
                  onClick={() => handleArchiveToggle(def)}
                  aria-label={
                    def.archived
                      ? t('settings:customFields.actions.unarchive')
                      : t('settings:customFields.actions.archive')
                  }
                >
                  {def.archived ? (
                    <ArchiveRestore className="h-4 w-4" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CustomFieldDefinitionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entity={entity}
        editing={editing}
      />
    </div>
  )
}

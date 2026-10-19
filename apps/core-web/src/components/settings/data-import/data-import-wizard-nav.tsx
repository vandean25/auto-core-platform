import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const WIZARD_STEPS = [
  { id: 1, labelKey: 'dataImport.steps.source' },
  { id: 2, labelKey: 'dataImport.steps.upload' },
  { id: 3, labelKey: 'dataImport.steps.mapping' },
  { id: 4, labelKey: 'dataImport.steps.dryRun' },
  { id: 5, labelKey: 'dataImport.steps.apply' },
] as const

export type DataImportWizardNavProps = {
  step: number
}

/** Navigation that shows the five steps of the import wizard. */
export function DataImportWizardNav(props: DataImportWizardNavProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <nav aria-label={t('dataImport.stepsNavAria')} className="flex flex-wrap gap-2">
      {WIZARD_STEPS.map((wizardStep) => (
        <Badge
          key={wizardStep.id}
          variant={props.step === wizardStep.id ? 'default' : 'outline'}
          className={cn('text-xs', props.step > wizardStep.id && 'border-green-600 text-green-700')}
        >
          {wizardStep.id}. {t(wizardStep.labelKey)}
        </Badge>
      ))}
    </nav>
  )
}

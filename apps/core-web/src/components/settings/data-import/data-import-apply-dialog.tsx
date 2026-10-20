import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import type { ImportJob } from '@/api/imports'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatNumber } from '@/lib/format'

import type { ImportEntityTypeUi } from './import-field-labels'

export type DataImportApplyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: ImportJob | null
  entityType: ImportEntityTypeUi
  acceptAllPriceJumps: boolean
  acceptedRowNumbers: number[]
  isApplying: boolean
  onConfirm: () => void
}

/** Confirmation dialog that applies the dry-run job to the tenant. */
export function DataImportApplyDialog(props: DataImportApplyDialogProps) {
  const { t } = useTranslation(['settings', 'common'])
  const job = props.job

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('dataImport.confirm.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>{t('dataImport.confirm.description')}</p>
              <ul className="list-disc pl-5">
                <li>{t('dataImport.confirm.create', { value: formatNumber(job?.totals.create ?? 0) })}</li>
                <li>{t('dataImport.confirm.update', { value: formatNumber(job?.totals.update ?? 0) })}</li>
                <li>{t('dataImport.confirm.skip', { value: formatNumber(job?.totals.skip ?? 0) })}</li>
                <li>{t('dataImport.confirm.errors', { value: formatNumber(job?.totals.error ?? 0) })}</li>
                {props.entityType === 'SUPPLIER_PRICE_LIST' ? (
                  <li>
                    {t('dataImport.confirm.priceJumps', {
                      value: props.acceptAllPriceJumps
                        ? t('dataImport.confirm.priceJumpsAll')
                        : t('dataImport.confirm.priceJumpsRows', {
                            rows: formatNumber(props.acceptedRowNumbers.length),
                          }),
                    })}
                  </li>
                ) : null}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={props.isApplying}
            onClick={(event) => {
              event.preventDefault()
              props.onConfirm()
            }}
          >
            {props.isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('dataImport.confirm.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

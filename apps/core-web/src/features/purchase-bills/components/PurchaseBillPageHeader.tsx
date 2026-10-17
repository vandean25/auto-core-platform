import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CircleDollarSign, Loader2, Package, ReceiptText } from 'lucide-react'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { formatCurrency } from '@/lib/utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { PurchaseBillFormModel } from '../form-model'

export function PurchaseBillPageHeader({ form }: { form: PurchaseBillFormModel }) {
  const { t } = useTranslation('finance')
  useEffect(() => {
    void ensureNamespaceLoaded('finance')
  }, [])

  const { isEdit, initialData, onCancel, totals, saveStatus, isPending, isCreating, isPosting } = form

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={onCancel} aria-label={t('actions.back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit
              ? t('purchaseBills.form.editTitle', { number: initialData?.vendor_invoice_number })
              : t('purchaseBills.form.logNewTitle')}
          </h1>
          <p className="text-slate-500">
            {isEdit ? t('purchaseBills.form.editSubtitle') : t('purchaseBills.form.logNewSubtitle')}
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 xl:w-auto xl:items-end">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:min-w-[430px]">
          <div className="rounded-xl border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Package className="h-3.5 w-3.5" />
              <span>{t('purchaseBills.form.summaryItems')}</span>
            </div>
            <div className="mt-1 text-sm font-medium">{formatCurrency(totals.subtotal)}</div>
          </div>
          <div className="rounded-xl border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ReceiptText className="h-3.5 w-3.5" />
              <span>{t('purchaseBills.form.summaryTax')}</span>
            </div>
            <div className="mt-1 text-sm font-medium">{formatCurrency(totals.taxTotal)}</div>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-primary/80">
              <CircleDollarSign className="h-3.5 w-3.5" />
              <span>{t('purchaseBills.form.summaryTotal')}</span>
            </div>
            <div className="mt-1 text-sm font-semibold text-primary">
              {formatCurrency(totals.grandTotal)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {isEdit ? (
            <div className="flex items-center gap-6">
              <DocumentSaveIndicator status={saveStatus} />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="default" className="bg-blue-600 hover:bg-blue-700" disabled={isPending}>
                    {isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {t('actions.postBill')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('purchaseBills.form.postConfirmTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('purchaseBills.form.postConfirmDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void form.handlePost()} disabled={isPosting}>
                      {isPosting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      {t('actions.postBill')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCancel} disabled={isCreating}>
                {t('actions.cancel')}
              </Button>
              <Button variant="secondary" onClick={() => void form.handleCreateDraft()} disabled={isCreating}>
                {isCreating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Loader2 className="mr-2 h-4 w-4 hidden" />
                )}
                {t('actions.createDraft')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type {
  RecordWorkshopOverrunNoticeBody,
  WorkshopEstimateOverrunWarning,
} from '@/api/workshop-estimates'
import {
  advisorChannelOptions,
  customerReactionOptions,
  overrunNoticeErrorMessages,
  type AdvisorChannel,
  type CustomerReaction,
  formatEstimateMoney,
  isRecordableNote,
  isSameGrossAmount,
  messageForErrorCode,
  normalizeGrossAmount,
} from '@/features/workshop/workshop-estimate-decision'
import { getErrorCode } from '@/lib/error-utils'

export interface RecordOverrunNoticeDialogProps {
  warning: WorkshopEstimateOverrunWarning | null
  onSubmit: (body: RecordWorkshopOverrunNoticeBody) => Promise<void>
  onClose: () => void
}

/**
 * The advisor records that the customer was told about the overrun, how, and how the customer reacted. The amount is
 * the current gross total of the order. A changed total can be noticed again, and the latest notice replaces the earlier one.
 */
export function RecordOverrunNoticeDialog({ warning, onSubmit, onClose }: RecordOverrunNoticeDialogProps) {
  return (
    <Dialog open={warning !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {warning && <NoticeForm key={warning.current_total_gross} warning={warning} onSubmit={onSubmit} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function NoticeForm({
  warning,
  onSubmit,
  onClose,
}: {
  warning: WorkshopEstimateOverrunWarning
  onSubmit: (body: RecordWorkshopOverrunNoticeBody) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('workshop')
  const [channel, setChannel] = useState<AdvisorChannel | ''>('')
  const [amount, setAmount] = useState(warning.current_total_gross)
  const [reaction, setReaction] = useState<CustomerReaction | ''>('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const normalizedAmount = normalizeGrossAmount(amount)
  const amountMatches = normalizedAmount !== null && isSameGrossAmount(normalizedAmount, warning.current_total_gross)
  const canSubmit = channel !== '' && reaction !== '' && amountMatches && isRecordableNote(note) && !submitting

  const handleSubmit = async () => {
    if (channel === '' || reaction === '' || normalizedAmount === null || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        channel,
        amount_quoted_gross: normalizedAmount,
        customer_reaction: reaction,
        note: note.trim(),
      })
    } catch (caught: unknown) {
      setError(
        messageForErrorCode(
          overrunNoticeErrorMessages(),
          getErrorCode(caught),
          t('estimateDecision.overrun.submitFailed'),
        ),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('estimateDecision.overrun.title')}</DialogTitle>
        <DialogDescription>
          {t('estimateDecision.overrun.description', {
            current: formatEstimateMoney(warning.current_total_gross),
            approved: formatEstimateMoney(warning.approved_total_gross),
          })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="notice-channel">{t('estimateDecision.overrun.channel')}</Label>
          <Select value={channel} onValueChange={(value) => setChannel(value as AdvisorChannel)}>
            <SelectTrigger id="notice-channel" aria-label={t('estimateDecision.overrun.channel')}>
              <SelectValue placeholder={t('estimateDecision.overrun.channelPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {advisorChannelOptions().map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notice-reaction">{t('estimateDecision.overrun.reaction')}</Label>
          <Select value={reaction} onValueChange={(value) => setReaction(value as CustomerReaction)}>
            <SelectTrigger id="notice-reaction" aria-label={t('estimateDecision.overrun.reaction')}>
              <SelectValue placeholder={t('estimateDecision.overrun.reactionPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {customerReactionOptions().map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notice-amount">{t('estimateDecision.overrun.amount')}</Label>
        <Input
          id="notice-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={amount !== '' && !amountMatches}
        />
        <p className="text-xs text-slate-500">{t('estimateDecision.overrun.amountHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notice-note">{t('estimateDecision.overrun.note')}</Label>
        <textarea
          id="notice-note"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('estimateDecision.overrun.notePlaceholder')}
        />
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          {t('estimateDecision.overrun.cancel')}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {t('estimateDecision.overrun.submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}

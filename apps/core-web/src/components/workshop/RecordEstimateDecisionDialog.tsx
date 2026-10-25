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
  RecordWorkshopEstimateDecisionBody,
  WorkshopEstimateVersionSummary,
} from '@/api/workshop-estimates'
import {
  advisorChannelOptions,
  recordDecisionErrorMessages,
  formatEstimateMoney,
  reactionOptionsFor,
  type AdvisorChannel,
  type CustomerReaction,
  type EstimateDecision,
  isRecordableNote,
  isSameGrossAmount,
  messageForErrorCode,
  normalizeGrossAmount,
} from '@/features/workshop/workshop-estimate-decision'
import { getErrorCode } from '@/lib/error-utils'

export interface RecordEstimateDecisionDialogProps {
  version: WorkshopEstimateVersionSummary | null
  onSubmit: (body: RecordWorkshopEstimateDecisionBody) => Promise<void>
  onClose: () => void
}

/**
 * The advisor records what the customer answered by phone, in person or by email. The amount has to be the gross
 * total of the sent version, and the note is required. Nothing is sent to the customer from here.
 */
export function RecordEstimateDecisionDialog({ version, onSubmit, onClose }: RecordEstimateDecisionDialogProps) {
  return (
    <Dialog open={version !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {version && <DecisionForm key={version.id} version={version} onSubmit={onSubmit} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function DecisionForm({
  version,
  onSubmit,
  onClose,
}: {
  version: WorkshopEstimateVersionSummary
  onSubmit: (body: RecordWorkshopEstimateDecisionBody) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation('workshop')
  const [decision, setDecision] = useState<EstimateDecision>('APPROVED')
  const [channel, setChannel] = useState<AdvisorChannel | ''>('')
  const [amount, setAmount] = useState(version.total_gross ?? '')
  const [reaction, setReaction] = useState<CustomerReaction | ''>('')
  const [decidedAt, setDecidedAt] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reactionOptions = reactionOptionsFor(decision)
  /** A reaction that does not fit the new decision is cleared, so the form never sends one. */
  const changeDecision = (next: EstimateDecision) => {
    setDecision(next)
    setReaction((current) => (reactionOptionsFor(next).some((option) => option.value === current) ? current : ''))
  }

  const normalizedAmount = normalizeGrossAmount(amount)
  const amountMatches = normalizedAmount !== null && isSameGrossAmount(normalizedAmount, version.total_gross)
  const canSubmit = channel !== '' && amountMatches && isRecordableNote(note) && !submitting

  const handleSubmit = async () => {
    if (channel === '' || normalizedAmount === null || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        decision,
        channel,
        amount_quoted_gross: normalizedAmount,
        note: note.trim(),
        ...(reaction !== '' ? { customer_reaction: reaction } : {}),
        ...(decidedAt !== '' ? { decided_at: new Date(decidedAt).toISOString() } : {}),
      })
    } catch (caught: unknown) {
      setError(
        messageForErrorCode(
          recordDecisionErrorMessages(),
          getErrorCode(caught),
          t('estimateDecision.record.submitFailed'),
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
        <DialogTitle>{t('estimateDecision.record.title')}</DialogTitle>
        <DialogDescription>
          {t('estimateDecision.record.description', {
            version: version.version,
            total: formatEstimateMoney(version.total_gross),
          })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="decision-kind">{t('estimateDecision.record.decision')}</Label>
          <Select value={decision} onValueChange={(value) => changeDecision(value as EstimateDecision)}>
            <SelectTrigger id="decision-kind" aria-label={t('estimateDecision.record.decision')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="APPROVED">{t('estimateDecision.record.decisionApproved')}</SelectItem>
              <SelectItem value="DECLINED">{t('estimateDecision.record.decisionDeclined')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="decision-channel">{t('estimateDecision.record.channel')}</Label>
          <Select value={channel} onValueChange={(value) => setChannel(value as AdvisorChannel)}>
            <SelectTrigger id="decision-channel" aria-label={t('estimateDecision.record.channel')}>
              <SelectValue placeholder={t('estimateDecision.record.channelPlaceholder')} />
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
          <Label htmlFor="decision-amount">{t('estimateDecision.record.amount')}</Label>
          <Input
            id="decision-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={amount !== '' && !amountMatches}
          />
          <p className="text-xs text-slate-500">{t('estimateDecision.record.amountHint')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="decision-reaction">{t('estimateDecision.record.reaction')}</Label>
          <Select value={reaction} onValueChange={(value) => setReaction(value as CustomerReaction)}>
            <SelectTrigger id="decision-reaction" aria-label={t('estimateDecision.record.reaction')}>
              <SelectValue placeholder={t('estimateDecision.record.reactionPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {reactionOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="decision-at">{t('estimateDecision.record.decidedAt')}</Label>
        <Input
          id="decision-at"
          type="datetime-local"
          value={decidedAt}
          onChange={(event) => setDecidedAt(event.target.value)}
        />
        <p className="text-xs text-slate-500">{t('estimateDecision.record.decidedAtHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="decision-note">{t('estimateDecision.record.note')}</Label>
        <textarea
          id="decision-note"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('estimateDecision.record.notePlaceholder')}
        />
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          {t('estimateDecision.record.cancel')}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {t('estimateDecision.record.submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}

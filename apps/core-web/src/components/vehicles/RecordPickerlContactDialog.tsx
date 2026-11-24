import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRecordPickerlContact, type RecordPickerlContactInput } from '@/api/vehicles'

type Channel = RecordPickerlContactInput['channel']
type Outcome = NonNullable<RecordPickerlContactInput['outcome']>
type NoConsentReason = NonNullable<RecordPickerlContactInput['no_consent_reason']>

const OUTCOME_NONE = 'NONE'

type RecordPickerlContactDialogProps = {
  vehicleId: string
  plate: string
  phoneConsentAllowed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecordPickerlContactDialog({
  vehicleId,
  plate,
  phoneConsentAllowed,
  open,
  onOpenChange,
}: RecordPickerlContactDialogProps) {
  const { t } = useTranslation(['vehicles', 'common'])
  const [channel, setChannel] = useState<Channel>('PHONE')
  const [outcome, setOutcome] = useState<Outcome | typeof OUTCOME_NONE>(OUTCOME_NONE)
  const [noConsentReason, setNoConsentReason] = useState<NoConsentReason | ''>('')
  const [revokeConsent, setRevokeConsent] = useState(false)

  const recordMutation = useRecordPickerlContact()
  const needsConsentReason = channel === 'PHONE' && !phoneConsentAllowed
  const canSubmit = !recordMutation.isPending && (!needsConsentReason || Boolean(noConsentReason))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    try {
      await recordMutation.mutateAsync({
        vehicleId,
        channel,
        outcome: outcome === OUTCOME_NONE ? undefined : outcome,
        no_consent_reason: needsConsentReason && noConsentReason ? noConsentReason : undefined,
        revoke_phone_consent: revokeConsent || undefined,
      })
      toast.success(t('vehicles:pickerlDue.contactDialog.saveSuccess'))
      onOpenChange(false)
    } catch {
      toast.error(t('vehicles:pickerlDue.contactDialog.saveError'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('vehicles:pickerlDue.contactDialog.title')} · {plate}</DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pickerl-contact-channel">
              {t('vehicles:pickerlDue.contactDialog.channel')}
            </Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <SelectTrigger id="pickerl-contact-channel" className="max-sm:min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PHONE">{t('vehicles:pickerlDue.contactDialog.channels.PHONE')}</SelectItem>
                <SelectItem value="EMAIL">{t('vehicles:pickerlDue.contactDialog.channels.EMAIL')}</SelectItem>
                <SelectItem value="SMS">{t('vehicles:pickerlDue.contactDialog.channels.SMS')}</SelectItem>
                <SelectItem value="IN_PERSON">{t('vehicles:pickerlDue.contactDialog.channels.IN_PERSON')}</SelectItem>
                <SelectItem value="POST">{t('vehicles:pickerlDue.contactDialog.channels.POST')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickerl-contact-outcome">
              {t('vehicles:pickerlDue.contactDialog.outcome')}
            </Label>
            <Select
              value={outcome}
              onValueChange={(v) => setOutcome(v as Outcome | typeof OUTCOME_NONE)}
            >
              <SelectTrigger id="pickerl-contact-outcome" className="max-sm:min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OUTCOME_NONE}>
                  {t('vehicles:pickerlDue.contactDialog.outcomeNone')}
                </SelectItem>
                <SelectItem value="REACHED">
                  {t('vehicles:pickerlDue.contactDialog.outcomes.REACHED')}
                </SelectItem>
                <SelectItem value="NO_ANSWER">
                  {t('vehicles:pickerlDue.contactDialog.outcomes.NO_ANSWER')}
                </SelectItem>
                <SelectItem value="APPOINTMENT_BOOKED">
                  {t('vehicles:pickerlDue.contactDialog.outcomes.APPOINTMENT_BOOKED')}
                </SelectItem>
                <SelectItem value="DECLINED">
                  {t('vehicles:pickerlDue.contactDialog.outcomes.DECLINED')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {needsConsentReason && (
            <div className="space-y-2">
              <Label htmlFor="pickerl-contact-no-consent-reason">
                {t('vehicles:pickerlDue.contactDialog.noConsentReason')}
              </Label>
              <Select
                value={noConsentReason}
                onValueChange={(v) => setNoConsentReason(v as NoConsentReason)}
              >
                <SelectTrigger id="pickerl-contact-no-consent-reason" className="max-sm:min-h-11">
                  <SelectValue
                    placeholder={t('vehicles:pickerlDue.contactDialog.noConsentReasonPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUSTOMER_CALLED">
                    {t('vehicles:pickerlDue.contactDialog.reasons.CUSTOMER_CALLED')}
                  </SelectItem>
                  <SelectItem value="ACTIVE_ORDER">
                    {t('vehicles:pickerlDue.contactDialog.reasons.ACTIVE_ORDER')}
                  </SelectItem>
                  <SelectItem value="MARKETING_CALL_WITHOUT_CONSENT">
                    {t('vehicles:pickerlDue.contactDialog.reasons.MARKETING_CALL_WITHOUT_CONSENT')}
                  </SelectItem>
                </SelectContent>
              </Select>

              {noConsentReason === 'MARKETING_CALL_WITHOUT_CONSENT' && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-warning bg-card p-3 text-sm text-warning"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('vehicles:pickerlDue.contactDialog.marketingWithoutConsentWarning')}</span>
                </div>
              )}
            </div>
          )}

          {phoneConsentAllowed && (
            <div className="flex items-start gap-3 rounded-md border border-border p-3">
              <Checkbox
                id="pickerl-contact-revoke-consent"
                checked={revokeConsent}
                onCheckedChange={(checked) => setRevokeConsent(checked === true)}
              />
              <div className="space-y-1 leading-none">
                <Label htmlFor="pickerl-contact-revoke-consent" className="cursor-pointer">
                  {t('vehicles:pickerlDue.contactDialog.revokeConsent')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('vehicles:pickerlDue.contactDialog.revokeConsentHint')}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="max-sm:min-h-11"
              onClick={() => onOpenChange(false)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" className="max-sm:min-h-11" disabled={!canSubmit}>
              {recordMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {recordMutation.isPending ? t('common:documentSave.saving') : t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

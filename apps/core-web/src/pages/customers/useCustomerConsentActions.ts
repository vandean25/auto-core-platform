import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useRecordCommunicationEvent, type useCustomerCommunicationPreferences } from '@/api/customer-consent'

type Preferences = ReturnType<typeof useCustomerCommunicationPreferences>['data']

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** Grant and revoke dialogs of the consent panel: their form state and the recorded events. */
export function useCustomerConsentActions(customerId: string, contactEmail: string | null | undefined, preferences: Preferences) {
  const { t, i18n } = useTranslation('customers')
  const recordEvent = useRecordCommunicationEvent(customerId)
  const [grantOpen, setGrantOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [purpose, setPurpose] = useState('NEWSLETTER')
  const [textVersion, setTextVersion] = useState('mkt-v1')
  const [textSnapshot, setTextSnapshot] = useState('')

  const submitGrant = async () => {
    if (!preferences || !textSnapshot.trim()) {
      toast.error(t('consent.textRequired'))
      return
    }
    try {
      await recordEvent.mutateAsync({
        controller_legal_entity_id: preferences.controller_legal_entity_id,
        expected_revision: preferences.revision,
        idempotency_key: `grant-${purpose}-${Date.now()}`,
        channel: 'EMAIL',
        purpose,
        status: 'GRANTED',
        basis: 'CONSENT',
        source: 'PROFILE',
        contact_address: contactEmail ?? undefined,
        text_version: textVersion,
        text_language: i18n.language.slice(0, 2),
        text_snapshot: textSnapshot.trim(),
      })
      toast.success(t('consent.saved'))
      setGrantOpen(false)
      setTextSnapshot('')
    } catch (error: unknown) {
      toast.error(failureMessage(error, t('consent.failed')))
    }
  }

  const submitRevoke = async () => {
    if (!preferences) return
    try {
      await recordEvent.mutateAsync({
        controller_legal_entity_id: preferences.controller_legal_entity_id,
        expected_revision: preferences.revision,
        idempotency_key: `revoke-${purpose}-${Date.now()}`,
        channel: 'EMAIL',
        purpose,
        status: 'REVOKED',
        source: 'PROFILE',
        contact_address: contactEmail ?? undefined,
      })
      toast.success(t('consent.saved'))
      setRevokeOpen(false)
    } catch (error: unknown) {
      toast.error(failureMessage(error, t('consent.failed')))
    }
  }

  return {
    grantOpen,
    setGrantOpen,
    revokeOpen,
    setRevokeOpen,
    purpose,
    setPurpose,
    textVersion,
    setTextVersion,
    textSnapshot,
    setTextSnapshot,
    isPending: recordEvent.isPending,
    submitGrant,
    submitRevoke,
  }
}

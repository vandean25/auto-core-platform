import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { resendWorkshopReadyEmail, type WorkshopReadyEmailNotice } from '@/api/workshop-ready-email'
import { workshopCommunicationKeys } from '@/api/workshop-communications'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

const BLOCKED_CODES = new Set([
  'BLOCKED_NO_CUSTOMER',
  'BLOCKED_EMAIL_NOT_CONFIRMED',
  'BLOCKED_EMAIL_MISSING',
  'BLOCKED_EMAIL_INVALID',
  'BLOCKED_VEHICLE_INCOMPLETE',
  'BLOCKED_SELLER_INCOMPLETE',
  'NOT_QUEUED',
  'FAILED',
])

export function WorkshopReadyEmailNotice({
  orderId,
  notice,
}: {
  orderId: string
  notice: WorkshopReadyEmailNotice | null | undefined
}) {
  const queryClient = useQueryClient()
  const resend = useMutation({
    mutationFn: () => resendWorkshopReadyEmail(orderId),
    onSuccess: async () => {
      toast.success('Abholbenachrichtigung erneut in die Warteschlange gestellt.')
      await queryClient.invalidateQueries({ queryKey: workshopCommunicationKeys.order(orderId) })
      await queryClient.invalidateQueries({ queryKey: ['workshop', 'orders', orderId] })
    },
    onError: () => {
      toast.error('Abholbenachrichtigung konnte nicht erneut gesendet werden.')
    },
  })

  if (!notice || notice.code === 'NOT_APPLICABLE') {
    return null
  }

  const showResend = BLOCKED_CODES.has(notice.code)

  return (
    <Alert variant={showResend ? 'destructive' : 'default'}>
      <Mail className="h-4 w-4" />
      <AlertTitle as="h3">Abholbenachrichtigung per E-Mail</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{notice.message}</p>
        {showResend ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={resend.isPending}
            onClick={() => void resend.mutate()}
          >
            {resend.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Wird gesendet …
              </>
            ) : (
              'Erneut senden'
            )}
          </Button>
        ) : null}
        {notice.code === 'QUEUED' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Versand läuft …
          </p>
        ) : null}
        {notice.code === 'SENT' ? (
          <p className="flex items-center gap-2 text-xs text-emerald-700">
            <AlertTriangle className="h-3 w-3 opacity-0" aria-hidden="true" />
            Zugestellt oder in der Warteschlange beim Provider.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

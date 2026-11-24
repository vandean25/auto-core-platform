import { Mail, MessageSquare, Phone, Send, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export type PickerlContactChannel = 'PHONE' | 'EMAIL' | 'SMS' | 'IN_PERSON' | 'POST'

function ChannelIcon({ channel }: { channel: PickerlContactChannel }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-muted-foreground'
  switch (channel) {
    case 'PHONE':
      return <Phone className={cls} />
    case 'EMAIL':
      return <Mail className={cls} />
    case 'SMS':
      return <MessageSquare className={cls} />
    case 'IN_PERSON':
      return <User className={cls} />
    case 'POST':
      return <Send className={cls} />
  }
}

export function PickerlContactCell({
  contactedAt,
  channel,
  actorName,
  emDash,
  dimmed,
}: {
  contactedAt: string | null
  channel: PickerlContactChannel | null
  actorName: string | null
  emDash: string
  dimmed?: boolean
}) {
  const { t } = useTranslation('vehicles')
  if (!contactedAt || !channel) {
    return <span className={cn(dimmed && 'text-muted-foreground opacity-60')}>{emDash}</span>
  }
  const channelLabel = t(`pickerlDue.contactDialog.channels.${channel}`)
  const dateLabel = formatDate(contactedAt)
  return (
    <div className={cn('flex items-center gap-1.5 text-sm', dimmed && 'text-muted-foreground opacity-60')}>
      <ChannelIcon channel={channel} />
      <span>
        {dateLabel} · {channelLabel}
        {actorName ? ` · ${actorName}` : ''}
      </span>
    </div>
  )
}

export function PickerlPhoneCell({
  phone,
  phoneConsentAllowed,
  emDash,
}: {
  phone: string
  phoneConsentAllowed: boolean
  emDash: string
}) {
  const { t } = useTranslation('vehicles')
  if (phoneConsentAllowed) {
    if (!phone) {
      return <span>{emDash}</span>
    }
    return (
      <a
        href={`tel:${phone}`}
        className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline max-sm:min-h-11"
        onClick={(e) => e.stopPropagation()}
      >
        <Phone className="h-3.5 w-3.5 shrink-0" />
        <span>{phone}</span>
      </a>
    )
  }

  return (
    <div className="space-y-0.5 text-muted-foreground opacity-70">
      <div>{phone || emDash}</div>
      <div className="text-xs">{t('pickerlDue.noPhoneConsentHint')}</div>
      <div className="text-xs">{t('pickerlDue.obtainConsentHint')}</div>
    </div>
  )
}

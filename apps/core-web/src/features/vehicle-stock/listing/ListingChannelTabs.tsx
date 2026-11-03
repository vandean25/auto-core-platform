import { useTranslation } from 'react-i18next'
import type {
  VehicleListingDto,
  VehicleListingExportValidationResponse,
} from '@/api/vehicle-listing'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { mergeChannelValidationIssues } from './listing-field-issues'
import { translateListingIssue } from './listing-issue-i18n'

type ListingChannel = VehicleListingDto['channels'][number]
type ValidationChannel = VehicleListingExportValidationResponse['channels'][number]

type Props = {
  channels: ListingChannel[]
  validationChannels: ValidationChannel[]
  validationFailed: boolean
  onToggleActive: (platform: string, active: boolean) => void
}

/** One tab per marketplace channel: the offer toggle and its validation messages. */
export function ListingChannelTabs({
  channels,
  validationChannels,
  validationFailed,
  onToggleActive,
}: Props) {
  const { t } = useTranslation('vehicleStock')

  return (
    <Tabs defaultValue={channels[0]?.platform ?? 'MOBILE_DE'}>
      <TabsList>
        {channels.map((channel) => (
          <TabsTrigger key={channel.platform} value={channel.platform}>
            {channel.platform.replace('_', '.')}
          </TabsTrigger>
        ))}
      </TabsList>
      {channels.map((channel) => {
        const channelIssues = mergeChannelValidationIssues(validationChannels, channel.platform)
        const validationRow = validationChannels.find((row) => row.platform === channel.platform)
        return (
          <TabsContent key={channel.platform} value={channel.platform} className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`channel-${channel.platform}`}>{t('listing.portals.desiredActive')}</Label>
              <Checkbox
                id={`channel-${channel.platform}`}
                checked={channel.desired_state === 'ACTIVE'}
                onCheckedChange={(checked) => onToggleActive(channel.platform, checked === true)}
              />
            </div>
            <p className="text-xs text-slate-500">{t('listing.portals.validationTitle')}</p>
            {validationRow && !validationRow.serializer_supported ? (
              <p className="text-sm text-slate-600">{t('listing.portals.serializerUnsupported')}</p>
            ) : null}
            {validationFailed ? null : channelIssues.length === 0 ? (
              <p className="text-sm text-slate-600">{t('listing.portals.noIssues')}</p>
            ) : (
              <ul className="space-y-1 text-sm text-destructive">
                {channelIssues.map((issue) => (
                  <li key={`${issue.field}-${issue.code ?? 'message'}`}>
                    {translateListingIssue(t, issue)}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

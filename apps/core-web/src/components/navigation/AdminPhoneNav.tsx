import { useState } from 'react'
import { Menu, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

import { useSidebar } from '@/components/ui/sidebar'
import { PhoneBottomNav } from './PhoneBottomNav'
import { PhoneCreateSheet } from './PhoneCreateSheet'
import { getPhoneNavDestinations } from './phone-nav-config'

type AdminPhoneNavProps = {
  platformRole: string | null
  activeRole: Parameters<typeof getPhoneNavDestinations>[0]['activeRole']
  onOpenSearch: () => void
}

/** Role-based bottom bar of the admin shell. "More" opens the full sidebar sheet, "Search" the Cmd+K palette. */
export function AdminPhoneNav({ platformRole, activeRole, onOpenSearch }: AdminPhoneNavProps) {
  const { t } = useTranslation('nav')
  const { pathname, search } = useLocation()
  const { setOpenMobile } = useSidebar()
  const [createOpen, setCreateOpen] = useState(false)
  const destinations = getPhoneNavDestinations({ platformRole, activeRole })

  return (
    <>
      <PhoneBottomNav
        start={destinations.map((item) => ({
          id: item.id,
          label: t(item.phoneLabelKey),
          icon: item.icon,
          to: item.to,
          active: item.isActive(pathname, search),
        }))}
        create={{ label: t('phoneNav.create'), onSelect: () => setCreateOpen(true) }}
        end={[
          { id: 'search', label: t('phoneNav.search'), icon: Search, onSelect: onOpenSearch },
          { id: 'more', label: t('phoneNav.more'), icon: Menu, onSelect: () => setOpenMobile(true) },
        ]}
      />
      <PhoneCreateSheet open={createOpen} onOpenChange={setCreateOpen} activeRole={activeRole} />
    </>
  )
}

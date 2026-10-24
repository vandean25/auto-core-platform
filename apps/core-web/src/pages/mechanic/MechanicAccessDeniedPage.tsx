import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageLoader } from '@/components/ui/PageLoader'
import { MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import { LocaleBundleLoadFailed, useLazyNamespaceBundleReady } from '@/lib/i18n'

function MechanicAccessDeniedContent() {
  const { t } = useTranslation('workshop')
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-12 sm:px-6">
      <Card className="mx-auto w-full max-w-lg text-center">
        <CardHeader>
          <CardTitle>{t('mechanic.accessDenied.title')}</CardTitle>
          <CardDescription>{t('mechanic.accessDenied.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to={MECHANIC_ROUTE_PATHS.queue}>{t('mechanic.accessDenied.backToQueue')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default function MechanicAccessDeniedPage() {
  const { status, retry } = useLazyNamespaceBundleReady(['workshop'])

  if (status === 'loading') {
    return <PageLoader />
  }
  if (status === 'failed') {
    return <LocaleBundleLoadFailed onRetry={retry} />
  }

  return <MechanicAccessDeniedContent />
}

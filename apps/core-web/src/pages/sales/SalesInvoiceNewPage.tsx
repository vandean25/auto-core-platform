import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ClipboardList, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PageHeader } from '@/components/layout/PageHeader'

export default function SalesInvoiceNewPage() {
  const { t } = useTranslation('sales')
  useEffect(() => {
    void ensureNamespaceLoaded('sales')
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        className="mb-0"
        leading={<FileText className="h-7 w-7 text-muted-foreground" />}
        title={t('invoices.newPage.title')}
        description={
          <>
            {t('invoices.newPage.descriptionBefore')}{' '}
            <span className="font-medium text-foreground">{t('invoices.newPage.createInvoiceAction')}</span>{' '}
            {t('invoices.newPage.descriptionAfter')}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('invoices.newPage.workflowTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>{t('invoices.newPage.step1')}</li>
            <li>
              {t('invoices.newPage.step2Before')}{' '}
              <span className="font-medium text-foreground">{t('invoices.newPage.step2Action')}</span>{' '}
              {t('invoices.newPage.step2After')}
            </li>
            <li>{t('invoices.newPage.step3')}</li>
          </ol>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <Link to={APP_ROUTE_PATHS.salesOrders}>
                <ClipboardList className="mr-2 h-4 w-4" />
                {t('invoices.newPage.openOrders')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={APP_ROUTE_PATHS.salesOrderNew}>{t('invoices.newPage.newOrder')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

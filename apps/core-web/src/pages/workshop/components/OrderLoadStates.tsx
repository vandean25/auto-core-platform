import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function OrderLoading() {
  const { t } = useTranslation('workshop')

  return (
    <div className="p-8 text-center text-sm text-muted-foreground">
      {t('orderDetail.loading')}
    </div>
  )
}

export function OrderNotFound() {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {t('orderDetail.notFoundTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          {t('orderDetail.notFoundDescription')}
        </p>
        <Button onClick={() => navigate('/workshop/orders')}>
          {t('orderDetail.backToOrders')}
        </Button>
      </CardContent>
    </Card>
  )
}

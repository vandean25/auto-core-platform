import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function NotFoundCard() {
  const { t } = useTranslation('common')

  return (
    <Card className="w-full max-w-sm text-center">
      <CardHeader>
        <CardTitle>{t('notFound.title')}</CardTitle>
        <CardDescription>{t('notFound.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full">
          <Link to="/">{t('notFound.goHome')}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

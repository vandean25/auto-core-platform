import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'

export default function MechanicAccessDeniedPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-12 sm:px-6">
      <Card className="mx-auto w-full max-w-lg text-center">
        <CardHeader>
          <CardTitle>Office access restricted</CardTitle>
          <CardDescription>
            You don&apos;t have access to office tools from a mechanic account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to={MECHANIC_ROUTE_PATHS.queue}>Go to mechanic queue</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

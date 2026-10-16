import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from 'react-error-boundary'
import type { FallbackProps } from 'react-error-boundary'
import { AlertCircle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { isChunkLoadError } from '@/lib/chunk-load-recovery'

function ErrorFallback({ error }: FallbackProps) {
  const { t } = useTranslation('common')
  const err = error as { name?: string; message?: string }
  const chunkLoadError = isChunkLoadError(err)

  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center p-4">
      <Card className="w-full max-w-md border-slate-200 shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertCircle className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight text-slate-900">
            {chunkLoadError ? t('errorBoundary.chunkTitle') : t('errorBoundary.unexpectedTitle')}
          </CardTitle>
          <CardDescription className="text-slate-500">
            {chunkLoadError ? t('errorBoundary.chunkDescription') : t('errorBoundary.unexpectedDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-slate-50 p-3 text-xs font-mono text-slate-600 overflow-auto max-h-32 border border-slate-200">
            {err?.message || t('errorBoundary.unknownError')}
          </div>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Button
            onClick={() => {
              window.location.reload()
            }}
            className="w-full gap-2 bg-slate-950 hover:bg-slate-800"
          >
            <RefreshCcw className="h-4 w-4" />
            {t('errorBoundary.reload')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

interface GlobalErrorBoundaryProps {
  children: React.ReactNode
}

export function GlobalErrorBoundary({ children }: GlobalErrorBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        window.location.reload()
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

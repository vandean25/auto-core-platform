import * as React from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import type { FallbackProps } from 'react-error-boundary'
import { AlertCircle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

function ErrorFallback({ error }: FallbackProps) {
  const err = error as any
  const isChunkLoadError = 
    err?.name === 'ChunkLoadError' || 
    err?.message?.includes('Failed to fetch dynamically imported module') ||
    err?.message?.includes('Importing a module script failed')

  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center p-4">
      <Card className="w-full max-w-md border-slate-200 shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertCircle className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight text-slate-900">
            {isChunkLoadError ? 'Update Required' : 'Unexpected Error'}
          </CardTitle>
          <CardDescription className="text-slate-500">
            {isChunkLoadError 
              ? 'The application was updated or encountered a network interruption. A reload is required to continue.'
              : 'The application encountered an unexpected error. Please try reloading to recover.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-slate-50 p-3 text-xs font-mono text-slate-600 overflow-auto max-h-32 border border-slate-200">
            {err?.message || 'Unknown error occurred'}
          </div>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Button 
            onClick={() => {
              // Perform a hard reload to clear stale manifests and cache
              window.location.reload()
            }}
            className="w-full gap-2 bg-slate-950 hover:bg-slate-800"
          >
            <RefreshCcw className="h-4 w-4" />
            Reload Application
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
        // This is called when resetErrorBoundary is invoked
        window.location.reload()
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

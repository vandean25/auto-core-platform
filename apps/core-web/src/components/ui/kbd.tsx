import * as React from 'react'

import { cn } from '@/lib/utils'

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-sans text-[0.625rem] font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }

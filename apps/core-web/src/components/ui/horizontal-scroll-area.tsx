import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type HorizontalScrollAreaProps = {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  scrollStep?: number
}

export function HorizontalScrollArea({
  children,
  className,
  contentClassName,
  scrollStep = 320,
}: HorizontalScrollAreaProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)

  const updateScrollState = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const { scrollLeft, scrollWidth, clientWidth } = el
    const overflow = scrollWidth > clientWidth + 1
    setCanScrollLeft(overflow && scrollLeft > 1)
    setCanScrollRight(overflow && scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    updateScrollState()

    el.addEventListener('scroll', updateScrollState, { passive: true })

    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(el)
    for (const child of el.children) {
      resizeObserver.observe(child)
    }

    return () => {
      el.removeEventListener('scroll', updateScrollState)
      resizeObserver.disconnect()
    }
  }, [updateScrollState, children])

  function scrollBy(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    <div className={cn('relative w-full min-w-0', className)} data-testid="horizontal-scroll-area">
      {canScrollLeft && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-slate-100 to-transparent"
        />
      )}

      {canScrollRight && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-slate-100 to-transparent"
        />
      )}

      {canScrollLeft && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute left-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-white/90 shadow-sm"
          aria-label="Scroll left"
          onClick={() => scrollBy(-scrollStep)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}

      {canScrollRight && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute right-1 top-1/2 z-20 h-8 w-8 -translate-y-1/2 rounded-full bg-white/90 shadow-sm"
          aria-label="Scroll right"
          onClick={() => scrollBy(scrollStep)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      <div
        ref={scrollRef}
        className={cn(
          'w-full min-w-0 overflow-x-auto scroll-smooth pb-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300',
        )}
      >
        <div className={cn('flex w-max min-w-full', contentClassName)}>{children}</div>
      </div>
    </div>
  )
}

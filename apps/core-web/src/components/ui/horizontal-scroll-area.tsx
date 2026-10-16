import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type HorizontalScrollAreaProps = {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  scrollStep?: number
  /** Accessible name for the scroll region (when horizontal scrolling is active). */
  ariaLabel?: string
  /**
   * `workshop-board`: stacks children vertically below `lg`, horizontal scroll with snap at `lg+`.
   */
  layout?: 'default' | 'workshop-board'
}

export function HorizontalScrollArea({
  children,
  className,
  contentClassName,
  scrollStep = 320,
  ariaLabel,
  layout = 'default',
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

  const isWorkshopBoard = layout === 'workshop-board'
  const showHorizontalChrome = !isWorkshopBoard || canScrollLeft || canScrollRight

  return (
    <div className={cn('relative w-full min-w-0', className)} data-testid="horizontal-scroll-area">
      {isWorkshopBoard && canScrollRight && (
        <p
          className="mb-2 hidden items-center gap-1 text-xs text-slate-600 lg:flex"
          data-testid="workshop-board-scroll-hint"
        >
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          Scroll or use the arrows to see more columns
        </p>
      )}

      {showHorizontalChrome && canScrollLeft && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-slate-100 to-transparent max-lg:hidden"
        />
      )}

      {showHorizontalChrome && canScrollRight && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-slate-100 to-transparent max-lg:hidden"
        />
      )}

      {showHorizontalChrome && canScrollLeft && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute left-1 top-1/2 z-20 h-11 w-11 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-white/90 shadow-sm max-lg:hidden"
          aria-label="Scroll left"
          onClick={() => scrollBy(-scrollStep)}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}

      {showHorizontalChrome && canScrollRight && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute right-1 top-1/2 z-20 h-11 w-11 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-white/90 shadow-sm max-lg:hidden"
          aria-label="Scroll right"
          onClick={() => scrollBy(scrollStep)}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      )}

      <div
        ref={scrollRef}
        role={isWorkshopBoard && showHorizontalChrome ? 'region' : undefined}
        aria-label={isWorkshopBoard && showHorizontalChrome ? ariaLabel : undefined}
        className={cn(
          'w-full min-w-0 scroll-smooth pb-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300',
          isWorkshopBoard
            ? 'max-lg:overflow-x-visible max-lg:pb-0 lg:overflow-x-auto lg:snap-x lg:snap-mandatory'
            : 'overflow-x-auto',
        )}
      >
        <div
          data-testid={isWorkshopBoard ? 'workshop-board-columns' : undefined}
          className={cn(
            'flex min-w-full',
            isWorkshopBoard
              ? 'max-lg:w-full max-lg:flex-col lg:w-max lg:flex-row'
              : 'w-max',
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

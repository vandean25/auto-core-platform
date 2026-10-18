import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('common')
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
  const workshopScrollControls = isWorkshopBoard && (canScrollLeft || canScrollRight)

  return (
    <div className={cn('relative w-full min-w-0', className)} data-testid="horizontal-scroll-area">
      {workshopScrollControls && (
        <div
          className="mb-2 hidden items-center justify-between gap-2 lg:flex"
          data-testid="workshop-board-scroll-hint"
        >
          <p className="flex min-w-0 items-center gap-1 text-xs text-slate-600">
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
            {t('scroll.workshopHint')}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {canScrollLeft && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 min-h-11 min-w-11 rounded-full shadow-sm"
                aria-label={t('scroll.left')}
                data-testid="workshop-board-scroll-left"
                onClick={() => scrollBy(-scrollStep)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            {canScrollRight && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 min-h-11 min-w-11 rounded-full shadow-sm"
                aria-label={t('scroll.right')}
                data-testid="workshop-board-scroll-right"
                onClick={() => scrollBy(scrollStep)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>
      )}

      {showHorizontalChrome && canScrollLeft && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-slate-100 to-transparent max-lg:hidden',
            isWorkshopBoard && 'top-0',
          )}
        />
      )}

      {showHorizontalChrome && canScrollRight && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-slate-100 to-transparent max-lg:hidden',
            isWorkshopBoard && 'top-0',
          )}
        />
      )}

      {!isWorkshopBoard && showHorizontalChrome && canScrollLeft && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute left-1 top-1/2 z-20 h-11 w-11 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-white/90 shadow-sm"
          aria-label={t('scroll.left')}
          onClick={() => scrollBy(-scrollStep)}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}

      {!isWorkshopBoard && showHorizontalChrome && canScrollRight && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute right-1 top-1/2 z-20 h-11 w-11 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-white/90 shadow-sm"
          aria-label={t('scroll.right')}
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

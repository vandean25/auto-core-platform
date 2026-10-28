import * as React from "react"

import { cn } from "@/lib/utils"

/** Which sides of a horizontally scrolling box still hide content. */
function useScrollEdges(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [edges, setEdges] = React.useState({ left: false, right: false })

  React.useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return

    const update = () => {
      const overflow = el.scrollWidth > el.clientWidth + 1
      const left = overflow && el.scrollLeft > 1
      const right = overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((previous) => (previous.left === left && previous.right === right ? previous : { left, right }))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => {
      el.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [ref, enabled])

  return edges
}

const edgeFade =
  "pointer-events-none absolute inset-y-0 z-10 w-8 from-slate-400/40 to-transparent"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    fixed?: boolean
    /** Shows an edge fade on the side that still hides columns and a visible scrollbar, so a wide table does not look cut off. */
    scrollCue?: boolean
  }
>(({ className, fixed = false, scrollCue = false, ...props }, ref) => {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef, scrollCue)

  const region = (
    <div
      ref={scrollRef}
      role="region"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scroll container must be focusable
      tabIndex={0}
      aria-label="Scrollable table"
      className={cn(
        "relative w-full overflow-auto",
        scrollCue &&
          "pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300"
      )}
    >
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", fixed && "table-fixed", className)}
        {...props}
      />
    </div>
  )
  if (!scrollCue) return region

  return (
    <div className="relative">
      {edges.left ? (
        <div aria-hidden data-testid="table-scroll-fade-left" className={cn(edgeFade, "left-0 bg-gradient-to-r")} />
      ) : null}
      {edges.right ? (
        <div aria-hidden data-testid="table-scroll-fade-right" className={cn(edgeFade, "right-0 bg-gradient-to-l")} />
      ) : null}
      {region}
    </div>
  )
})
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-11 px-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BreadcrumbItem = {
  label: string
  /** Target for an ancestor. Leave it out on the current page, which renders as text. */
  to?: string
}

type BreadcrumbsProps = {
  items: BreadcrumbItem[]
}

/** Trail above a page. The last item is the current page and carries `aria-current="page"`. */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1
          return (
            <li key={`${index}-${item.label}`} className="flex items-center gap-1.5">
              {index > 0 ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
              {isCurrent || !item.to ? (
                <span aria-current={isCurrent ? 'page' : undefined} className={cn(isCurrent && 'font-medium text-slate-900')}>
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="transition-colors hover:text-slate-900 hover:underline">
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

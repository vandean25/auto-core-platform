import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

export type DataTableRowContextAction<TData extends object> = {
  id?: string
  label: string
  onClick: (row: TData) => void
  destructive?: boolean
}

/** Right-click / keyboard context menu for table rows. Render `menu` once, call `openRowContextMenu` from a row. */
export function useDataTableContextMenu<TData extends object>(
  getRowContextActions?: (row: TData) => DataTableRowContextAction<TData>[],
) {
  const { t } = useTranslation('common')
  const [contextMenu, setContextMenu] = useState<{
    row: TData
    x: number
    y: number
  } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const openRowContextMenu = (row: TData, x: number, y: number) => {
    const actions = getRowContextActions?.(row)
    if (!actions || actions.length === 0) return false

    setContextMenu({ row, x, y })
    setMenuPosition({ top: y, left: x })
    return true
  }

  useEffect(() => {
    if (!contextMenu) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null)
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu || !menuRef.current) return

    const menuWidth = menuRef.current.offsetWidth
    const menuHeight = menuRef.current.offsetHeight
    const maxLeft = Math.max(0, window.innerWidth - menuWidth)
    const maxTop = Math.max(0, window.innerHeight - menuHeight)
    const clampedLeft = Math.max(0, Math.min(contextMenu.x, maxLeft))
    const clampedTop = Math.max(0, Math.min(contextMenu.y, maxTop))

    setMenuPosition({ top: clampedTop, left: clampedLeft })
  }, [contextMenu])

  const menu: ReactNode = contextMenu ? (
    <>
      <button
        type="button"
        aria-label={t('dataTable.closeContextMenu')}
        className="fixed inset-0 z-50 cursor-default"
        onClick={() => setContextMenu(null)}
        onContextMenu={(event) => {
          event.preventDefault()
          setContextMenu(null)
        }}
      />
      <div
        className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 shadow-md"
        style={{
          top: menuPosition?.top ?? contextMenu.y,
          left: menuPosition?.left ?? contextMenu.x,
        }}
        ref={menuRef}
      >
        {getRowContextActions?.(contextMenu.row).map((action: DataTableRowContextAction<TData>) => (
          <button
            key={action.id ?? action.label}
            type="button"
            data-action-id={action.id}
            className={`w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${
              action.destructive ? "text-destructive" : "text-foreground"
            }`}
            onClick={() => {
              action.onClick(contextMenu.row)
              setContextMenu(null)
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  ) : null

  return { openRowContextMenu, menu }
}

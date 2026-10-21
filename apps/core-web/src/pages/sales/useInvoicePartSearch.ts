import * as React from "react"

import { useInventory } from "@/api/inventory"
import type { InventoryItem } from "@/api/types"
import type { useInvoiceEditor } from "@/hooks/useInvoiceEditor"

const DEFAULT_TAX_RATE = 20

/** The part search for an invoice line: which line it fills and what the user typed. */
export function useInvoicePartSearch(updateItem: ReturnType<typeof useInvoiceEditor>["updateItem"]) {
  const [partSearchOpen, setPartSearchOpen] = React.useState(false)
  const [activeRowIndex, setActiveRowIndex] = React.useState<number | null>(null)
  const [inventorySearch, setInventorySearch] = React.useState("")
  const { data: inventory } = useInventory({ search: inventorySearch, pageSize: 10 })

  const openPartSearch = (index: number) => {
    setActiveRowIndex(index)
    setPartSearchOpen(true)
  }

  const handleSelectPart = (item: InventoryItem) => {
    if (activeRowIndex !== null) {
      updateItem(activeRowIndex, {
        catalog_item_id: item.id,
        description: item.name,
        unit_price: item.price,
        tax_rate: DEFAULT_TAX_RATE,
      })
    }
    setPartSearchOpen(false)
    setActiveRowIndex(null)
  }

  return {
    partSearchOpen,
    setPartSearchOpen,
    inventorySearch,
    setInventorySearch,
    inventoryItems: inventory?.data ?? [],
    openPartSearch,
    handleSelectPart,
  }
}

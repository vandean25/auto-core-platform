import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandList,
  CommandItem,
  CommandEmpty,
  CommandGroup,
} from "@/components/ui/command";
import { formatCurrency } from "@/lib/utils";
import type { InventoryItem, PurchaseOrderQuickAdd as QuickAdd } from "./usePurchaseOrderQuickAdd";

function PartSuggestions({
  items,
  hasVendorBrands,
  onSelect,
}: {
  items: InventoryItem[];
  hasVendorBrands: boolean;
  onSelect: (item: InventoryItem) => void;
}) {
  const { t } = useTranslation("finance");

  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border bg-popover shadow-md">
      <Command shouldFilter={false}>
        <CommandList className="max-h-64">
          {items.length === 0 && (
            <CommandEmpty>
              {hasVendorBrands
                ? t("purchaseOrders.detail.noPartsForBrands")
                : t("purchaseOrders.detail.noVendorBrands")}
            </CommandEmpty>
          )}
          {items.length > 0 && (
            <CommandGroup heading={t("purchaseOrders.detail.partsGroup")}>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.sku} ${item.name}`}
                  onSelect={() => onSelect(item)}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">
                        {item.sku}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.name}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{formatCurrency(item.price)}</div>
                      <div>{t("shared.stock", { count: item.quantity_available })}</div>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  );
}

export function QuickAddBar({ quickAdd }: { quickAdd: QuickAdd }) {
  const { t } = useTranslation("finance");
  const {
    itemInputRef,
    qtyInputRef,
    searchQuery,
    debouncedSearchQuery,
    newQty,
    setNewQty,
    stagedItem,
    showSuggestions,
    setShowSuggestions,
    filteredInventory,
    hasVendorBrands,
    isAdding,
    stagePart,
    confirmAddItem,
    changeSearch,
    handleSearchKeyDown,
    handleQtyKeyDown,
  } = quickAdd;

  return (
    <div className="border rounded-xl bg-muted/40 px-3 py-2">
      <div className="grid grid-cols-[1fr_70px_auto] gap-2">
        <div className="relative">
          <Input
            ref={itemInputRef}
            value={searchQuery}
            onChange={(e) => changeSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setShowSuggestions(true)}
            placeholder={t("purchaseOrders.detail.searchPartsPlaceholder")}
            className="h-8 text-xs"
          />
          {showSuggestions && debouncedSearchQuery && (
            <PartSuggestions
              items={filteredInventory}
              hasVendorBrands={hasVendorBrands}
              onSelect={stagePart}
            />
          )}
        </div>

        <Input
          ref={qtyInputRef}
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
          onKeyDown={handleQtyKeyDown}
          placeholder={t("purchaseOrders.detail.qtyPlaceholder")}
          className="h-8 text-xs text-right"
          disabled={!stagedItem}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={confirmAddItem}
          disabled={!stagedItem || isAdding}
        >
          {isAdding ? "..." : t("purchaseOrders.detail.addButton")}
        </Button>
      </div>
    </div>
  );
}

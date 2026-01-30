import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useBrands } from "@/api/brands"
import { Loader2 } from "lucide-react"

interface BrandComboboxProps {
    value?: number
    onChange: (brandId: number) => void
    placeholder?: string
}

export function BrandCombobox({ value, onChange, placeholder = "Select brand..." }: BrandComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const { data: brands, isLoading } = useBrands()

  const selectedBrand = brands?.find(b => b.id === value)

  return (
    <div className="flex items-center gap-2">
      {selectedBrand?.logoUrl && (
        <img src={selectedBrand.logoUrl} alt="" className="w-6 h-6 object-contain rounded border bg-white" />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={isLoading}
          >
            {isLoading ? (
                <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Loading...</span>
                </div>
            ) : (
                selectedBrand ? selectedBrand.name : placeholder
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <Command>
            <CommandInput placeholder="Search brand..." />
            <CommandList>
              <CommandEmpty>No brand found.</CommandEmpty>
              <CommandGroup>
                {brands?.map((brand) => (
                  <CommandItem
                    key={brand.id}
                    value={brand.name}
                    onSelect={() => {
                      onChange(brand.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === brand.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex items-center gap-2">
                        {brand.logoUrl && <img src={brand.logoUrl} className="w-4 h-4 object-contain" alt="" />}
                        {brand.name}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

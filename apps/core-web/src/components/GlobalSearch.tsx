import * as React from "react"
import {
    PlusCircle,
    User,
    Package,
    Wrench,
} from "lucide-react"

import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command"
import { useGlobalSearch } from "@/hooks/useGlobalSearch"

export function GlobalSearch() {
    const [open, setOpen] = React.useState(false)
    const [search, setSearch] = React.useState("")
    const { data: searchResults, isLoading } = useGlobalSearch(search)

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setOpen((open) => !open)
            }
        }

        document.addEventListener("keydown", down)
        return () => document.removeEventListener("keydown", down)
    }, [])

    return (
        <CommandDialog open={open} onOpenChange={setOpen}>
            <CommandInput
                placeholder="Type a command or search inventory..."
                value={search}
                onValueChange={setSearch}
            />
            <CommandList className="max-h-[300px] overflow-y-auto">
                <CommandEmpty>No results found.</CommandEmpty>

                <CommandGroup heading="🚀 Actions">
                    <CommandItem onSelect={() => { console.log("Navigate to Create Invoice"); setOpen(false) }}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        <span>Create New Invoice</span>
                        <CommandShortcut>⌘I</CommandShortcut>
                    </CommandItem>
                    <CommandItem onSelect={() => { console.log("Navigate to Register Customer"); setOpen(false) }}>
                        <User className="mr-2 h-4 w-4" />
                        <span>Register New Customer</span>
                        <CommandShortcut>⌘N</CommandShortcut>
                    </CommandItem>
                </CommandGroup>

                <CommandSeparator />

                <CommandGroup heading="📦 Inventory">
                    {isLoading ? (
                        <div className="py-6 text-center text-sm text-slate-500 italic">Searching inventory...</div>
                    ) : (
                        searchResults?.data.map((item) => (
                            <CommandItem
                                key={item.id}
                                onSelect={() => {
                                    console.log(`Navigate to inventory item: ${item.id}`);
                                    setOpen(false);
                                }}
                            >
                                <Package className="mr-2 h-4 w-4" />
                                <div className="flex flex-col">
                                    <span className="font-medium">{item.sku}</span>
                                    <span className="text-xs text-slate-500">{item.name}</span>
                                </div>
                            </CommandItem>
                        ))
                    )}
                    {search && !isLoading && (!searchResults || searchResults.data.length === 0) && (
                        <div className="py-6 text-center text-sm text-slate-500">No parts found matching "{search}"</div>
                    )}
                </CommandGroup>

                <CommandSeparator />

                <CommandGroup heading="🔧 Workshop">
                    <CommandItem disabled>
                        <Wrench className="mr-2 h-4 w-4" />
                        <span>Open Job Cards (Coming Soon)</span>
                    </CommandItem>
                </CommandGroup>
            </CommandList>
        </CommandDialog>
    )
}

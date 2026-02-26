import * as React from "react"
import { useNavigate } from "react-router-dom"
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

interface GlobalSearchProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
    const [search, setSearch] = React.useState("")
    const { data: searchResults, isLoading } = useGlobalSearch(search)
    const navigate = useNavigate()

    return (
        <CommandDialog open={open} onOpenChange={onOpenChange}>
            <CommandInput
                placeholder="Type a command or search inventory..."
                value={search}
                onValueChange={setSearch}
            />
            <CommandList className="max-h-[300px] overflow-y-auto">
                <CommandEmpty>No results found.</CommandEmpty>

                <CommandGroup heading="🚀 Actions">
                    <CommandItem onSelect={() => { console.log("Navigate to Create Invoice"); onOpenChange(false) }}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        <span>Create New Invoice</span>
                        <CommandShortcut>{navigator.userAgent.includes('Mac') ? '⌘I' : 'Ctrl+I'}</CommandShortcut>
                    </CommandItem>
                    <CommandItem onSelect={() => {
                        navigate('/customers?action=create')
                        onOpenChange(false)
                    }}>
                        <User className="mr-2 h-4 w-4" />
                        <span>Register New Customer</span>
                        <CommandShortcut>{navigator.userAgent.includes('Mac') ? '⌘N' : 'Ctrl+N'}</CommandShortcut>
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
                                    onOpenChange(false);
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

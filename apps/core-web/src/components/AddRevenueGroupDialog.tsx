import * as React from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useCreateRevenueGroup } from "@/api/useFinance"

export function AddRevenueGroupDialog() {
    const [open, setOpen] = React.useState(false)
    const createMutation = useCreateRevenueGroup()
    
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        
        try {
            await createMutation.mutateAsync({
                name: formData.get("name") as string,
                tax_rate: (formData.get("tax_rate") as unknown as string),
                account_number: formData.get("account_number") as string,
                is_default: formData.get("is_default") === "on",
            } as any)
            
            toast.success("Revenue group created")
            setOpen(false)
        } catch (error) {
            toast.error("Failed to create revenue group")
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" /> Add Group
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Add Revenue Group</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Name</Label>
                            <Input id="name" name="name" placeholder="e.g., Spare Parts 20%" required />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="tax_rate">Tax Rate (%)</Label>
                                <Input id="tax_rate" name="tax_rate" type="number" step="0.01" defaultValue="20.00" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="account_number">Account Number</Label>
                                <Input id="account_number" name="account_number" placeholder="4000" required />
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox id="is_default" name="is_default" />
                            <Label htmlFor="is_default">Set as default for new items</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={createMutation.isPending}>
                            {createMutation.isPending ? "Creating..." : "Create Group"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

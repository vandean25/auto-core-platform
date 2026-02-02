import React, { useState } from 'react'
import { useLocationTree, useCreateLocation, useDeleteLocation, type StorageLocation, type LocationType } from '@/api/locations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Trash2, Folder, ChevronRight, ChevronDown, Box } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const LocationTreeItem = ({ 
    location, 
    level = 0, 
    onDelete 
}: { 
    location: StorageLocation; 
    level?: number;
    onDelete: (id: string) => void;
}) => {
    const [expanded, setExpanded] = useState(true)
    const hasChildren = location.children && location.children.length > 0

    return (
        <div className="select-none">
            <div 
                className={cn(
                    "flex items-center gap-2 p-2 hover:bg-slate-100 rounded-md cursor-pointer group",
                    level > 0 && "ml-4 border-l-2 border-slate-200"
                )}
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-1 text-slate-500 w-4">
                    {hasChildren && (
                        expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                    )}
                </div>
                
                {location.type === 'warehouse' ? <Folder className="h-4 w-4 text-blue-500" /> : 
                 location.type === 'bin' ? <Box className="h-4 w-4 text-green-500" /> :
                 <div className="h-2 w-2 rounded-full bg-slate-400 mx-1" />}
                
                <span className="font-medium text-sm">{location.name}</span>
                <Badge variant="outline" className="text-xs h-5 ml-2 font-mono text-slate-400 group-hover:text-slate-600 transition-colors">
                    {location.code}
                </Badge>
                
                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Delete ${location.name}?`)) {
                                onDelete(location.id)
                            }
                        }}
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                </div>
            </div>
            
            {expanded && hasChildren && (
                <div className="ml-2">
                    {location.children!.map(child => (
                        <LocationTreeItem key={child.id} location={child} level={level + 1} onDelete={onDelete} />
                    ))}
                </div>
            )}
        </div>
    )
}

export default function LocationManagement() {
    const { data: tree, isLoading, refetch } = useLocationTree()
    const createMutation = useCreateLocation()
    const deleteMutation = useDeleteLocation()

    const [newItem, setNewItem] = useState({
        name: '',
        code: '',
        type: 'warehouse' as LocationType,
        parentId: ''
    })

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            await createMutation.mutateAsync({
                name: newItem.name,
                code: newItem.code,
                type: newItem.type,
                parentId: newItem.parentId || undefined
            })
            toast.success('Location created successfully')
            setNewItem({ name: '', code: '', type: 'warehouse', parentId: '' })
            refetch()
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Location deleted')
            refetch()
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    // Flatten tree for parent selection (simple version)
    const flatten = (nodes: StorageLocation[], result: StorageLocation[] = []) => {
        nodes.forEach(node => {
            result.push(node)
            if (node.children) flatten(node.children, result)
        })
        return result
    }
    const flatLocations = tree ? flatten(tree) : []

    return (
        <div className="p-8 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Storage Locations</h1>
                        <p className="text-slate-500">Manage hierarchical bin locations.</p>
                    </div>
                </div>

                <Card>
                    <CardContent className="p-4">
                        {isLoading ? (
                            <div className="flex items-center justify-center p-8 text-slate-500">
                                <Loader2 className="animate-spin h-6 w-6 mr-2" /> Loading hierarchy...
                            </div>
                        ) : tree?.length === 0 ? (
                            <div className="text-center p-8 text-slate-500">
                                No locations found. Create your first warehouse.
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {tree?.map(loc => (
                                    <LocationTreeItem key={loc.id} location={loc} onDelete={handleDelete} />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div>
                <Card>
                    <CardHeader>
                        <CardTitle>Add Location</CardTitle>
                        <CardDescription>Create a new storage unit.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Name</label>
                                <Input 
                                    value={newItem.name} 
                                    onChange={e => setNewItem({...newItem, name: e.target.value})}
                                    placeholder="e.g. Main Warehouse"
                                    required
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Code (Unique)</label>
                                <Input 
                                    value={newItem.code} 
                                    onChange={e => setNewItem({...newItem, code: e.target.value})}
                                    placeholder="e.g. WH-001"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Type</label>
                                <Select 
                                    value={newItem.type} 
                                    onValueChange={(val: LocationType) => setNewItem({...newItem, type: val})}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="warehouse">Warehouse</SelectItem>
                                        <SelectItem value="aisle">Aisle</SelectItem>
                                        <SelectItem value="shelf">Shelf</SelectItem>
                                        <SelectItem value="bin">Bin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Parent Location</label>
                                <Select 
                                    value={newItem.parentId} 
                                    onValueChange={(val) => setNewItem({...newItem, parentId: val === 'none' ? '' : val})}
                                    disabled={newItem.type === 'warehouse'}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={newItem.type === 'warehouse' ? "None (Root)" : "Select Parent"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None (Root)</SelectItem>
                                        {flatLocations.map(loc => (
                                            <SelectItem key={loc.id} value={loc.id}>
                                                {loc.name} ({loc.type})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                                {createMutation.isPending && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                                Create Location
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

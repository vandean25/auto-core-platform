import * as React from "react"
import { toast } from "sonner"
import { Plus, ChevronRight, ChevronDown, Loader2, GripVertical, Pencil } from "lucide-react"

import {
  useLaborCategories,
  useCreateLaborCategory,
  useUpdateLaborCategory,
  useDeleteLaborCategory,
} from "@/api/labor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

// ── Internal Types ─────────────────────────────────────────────────────────

interface CategoryRow {
  id: string
  name: string
  description: string | null
  sort_order: number | null
  parent_id: string | null
  default_hourly_rate: number | null
  is_active: boolean
  children: CategoryRow[]
}

interface CategoryFormState {
  name: string
  description: string
  sort_order: string
  parent_id: string
  default_hourly_rate: string
  is_active: boolean
}

const defaultFormState: CategoryFormState = {
  name: "",
  description: "",
  sort_order: "",
  parent_id: "none",
  default_hourly_rate: "",
  is_active: true,
}

// ── Inline Rate Editor ─────────────────────────────────────────────────────

function InlineRateEditor({
  value,
  onSave,
}: {
  value: number | null
  onSave: (rate: number | null) => Promise<void>
}) {
  const [editing, setEditing] = React.useState(false)
  const [input, setInput] = React.useState(value != null ? String(value) : "")
  const [isSaving, setIsSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  // Sync displayed value when the parent prop changes
  React.useEffect(() => {
    if (!editing) {
      setInput(value != null ? String(value) : "")
    }
  }, [value, editing])

  const handleSave = async () => {
    if (isSaving) return
    const trimmedInput = input.trim()
    const parsed = trimmedInput === "" ? null : parseFloat(trimmedInput)
    
    // Check if input is empty OR if parseFloat resulted in a valid number
    if (trimmedInput !== "" && isNaN(parsed as number)) {
        toast.error("Invalid hourly rate format")
        setEditing(false)
        setInput(value != null ? String(value) : "")
        return
    }

    const hasChanged = parsed !== value && !(parsed === null && value === null)
    
    if (hasChanged) {
        setIsSaving(true)
        try {
            await onSave(parsed)
        } finally {
            setIsSaving(false)
            setEditing(false)
        }
    } else {
        setEditing(false)
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        className="h-6 w-24 text-xs px-1.5 py-0"
        value={input}
        onChange={e => setInput(e.target.value)}
        onBlur={() => void handleSave()}
        onKeyDown={e => {
          if (e.key === "Enter") {
             e.preventDefault()
             void handleSave()
          }
          if (e.key === "Escape") {
            setEditing(false)
            setInput(value != null ? String(value) : "")
          }
        }}
        onClick={e => e.stopPropagation()}
        type="number"
        step="0.01"
        min="0"
        placeholder="—"
        disabled={isSaving}
      />
    )
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setEditing(true) }}
      className="text-xs text-slate-600 hover:underline cursor-pointer tabular-nums min-w-[64px] text-left"
      title="Click to edit rate"
    >
      {value != null ? `฿${value.toFixed(2)}` : <span className="text-slate-400">—</span>}
    </button>
  )
}

// ── Category Tree Row ──────────────────────────────────────────────────────

interface DragProps {
  dragging: string | null
  over: string | null
  onDragStart: (id: string) => void
  onDragOver: (e: React.DragEvent, id: string) => void
  onDrop: (e: React.DragEvent, targetId: string) => Promise<void>
  onDragEnd: () => void
}

function CategoryTreeRow({
  category,
  level = 0,
  topLevelCategories,
  onEdit,
  onContextMenu,
  onActiveToggle,
  onRateSave,
  dragProps,
}: {
  category: CategoryRow
  level?: number
  topLevelCategories: CategoryRow[]
  onEdit: (category: CategoryRow) => void
  onContextMenu: (e: React.MouseEvent, category: CategoryRow) => void
  onActiveToggle: (category: CategoryRow) => Promise<void>
  onRateSave: (id: string, rate: number | null) => Promise<void>
  dragProps: DragProps
}) {
  const [expanded, setExpanded] = React.useState(true)
  const hasChildren = category.children && category.children.length > 0
  const isDragging = dragProps.dragging === category.id
  const isDragOver = dragProps.over === category.id

  return (
    <div className={cn("select-none", isDragging && "opacity-40")}>
      <div
        className={cn(
          "flex items-center gap-2 p-2 rounded-md group transition-colors",
          level > 0 && "ml-6 border-l-2 border-slate-100 pl-3",
          isDragOver ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50",
        )}
        onContextMenu={e => onContextMenu(e, category)}
        draggable
        onDragStart={() => dragProps.onDragStart(category.id)}
        onDragOver={e => dragProps.onDragOver(e, category.id)}
        onDrop={e => void dragProps.onDrop(e, category.id)}
        onDragEnd={dragProps.onDragEnd}
      >
        {/* Drag Handle */}
        <GripVertical className="h-4 w-4 text-slate-300 cursor-grab active:cursor-grabbing shrink-0" />

        {/* Expand / Collapse */}
        <button
          className="flex items-center justify-center w-4 h-4 text-slate-400 shrink-0"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          aria-label={expanded ? "Collapse" : "Expand"}
          tabIndex={-1}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="w-4 h-4" />
          )}
        </button>

        {/* Name – click to edit */}
        <button
          className="text-sm font-medium text-slate-800 hover:text-blue-600 truncate flex-1 text-left"
          onClick={() => onEdit(category)}
        >
          {category.name}
        </button>

        {/* Hourly Rate (inline edit) */}
        <InlineRateEditor
          value={category.default_hourly_rate}
          onSave={rate => onRateSave(category.id, rate)}
        />

        {/* is_active Toggle */}
        <button
          onClick={e => { e.stopPropagation(); void onActiveToggle(category) }}
          className={cn(
            "text-xs px-2 py-0.5 rounded-full border font-medium transition-colors shrink-0",
            category.is_active
              ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              : "bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200",
          )}
          title="Toggle active status"
        >
          {category.is_active ? "Active" : "Inactive"}
        </button>

        {/* Edit Button */}
        <button
          onClick={e => { e.stopPropagation(); onEdit(category) }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700 shrink-0"
          title="Edit category"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {category.children.map(child => (
            <CategoryTreeRow
              key={child.id}
              category={child}
              level={level + 1}
              topLevelCategories={topLevelCategories}
              onEdit={onEdit}
              onContextMenu={onContextMenu}
              onActiveToggle={onActiveToggle}
              onRateSave={onRateSave}
              dragProps={dragProps}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function LaborCategoriesTab() {
  const { data: categoriesData, isLoading } = useLaborCategories()
  const createMutation = useCreateLaborCategory()
  const updateMutation = useUpdateLaborCategory()
  const deleteMutation = useDeleteLaborCategory()

  // Normalise the raw API response to our internal type (handles nullable quirks)
  const categories: CategoryRow[] = React.useMemo(() => {
    if (!categoriesData?.data) return []
    return categoriesData.data.map(cat => ({
      id: cat.id,
      name: cat.name,
      description: (cat.description as unknown as string | null) ?? null,
      sort_order: (cat.sort_order as unknown as number | null) ?? null,
      parent_id: (cat.parent_id as unknown as string | null) ?? null,
      default_hourly_rate: (cat.default_hourly_rate as unknown as number | null) ?? null,
      is_active: cat.is_active,
      children: (cat.children || []).map(child => ({
        id: child.id,
        name: child.name,
        description: (child.description as unknown as string | null) ?? null,
        sort_order: (child.sort_order as unknown as number | null) ?? null,
        parent_id: (child.parent_id as unknown as string | null) ?? null,
        default_hourly_rate: (child.default_hourly_rate as unknown as number | null) ?? null,
        is_active: child.is_active,
        children: [],
      })),
    }))
  }, [categoriesData])

  // ── Add form ──
  const [addForm, setAddForm] = React.useState<CategoryFormState>(defaultFormState)
  const [isAddPending, setIsAddPending] = React.useState(false)

  // ── Edit dialog ──
  const [editCategory, setEditCategory] = React.useState<CategoryRow | null>(null)
  const [editForm, setEditForm] = React.useState<CategoryFormState>(defaultFormState)
  const [isEditOpen, setIsEditOpen] = React.useState(false)

  // ── Delete dialog ──
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryRow | null>(null)
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false)

  // ── Context menu ──
  const [contextMenu, setContextMenu] = React.useState<{
    categoryId: string
    categoryName: string
    x: number
    y: number
  } | null>(null)

  // ── Drag state ──
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [dragOverId, setDragOverId] = React.useState<string | null>(null)

  // Flat list for lookups (parent selectors, etc.)
  const flatCategories = React.useMemo(() => {
    const result: CategoryRow[] = []
    categories.forEach(cat => {
      result.push(cat)
      cat.children.forEach(child => result.push(child))
    })
    return result
  }, [categories])

  // Dismiss context menu when clicking anywhere
  React.useEffect(() => {
    const handler = () => setContextMenu(null)
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [])

  // ── Add handler ──
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.name.trim()) return
    setIsAddPending(true)
    try {
      await createMutation.mutateAsync({
        name: addForm.name.trim(),
        ...(addForm.description.trim() ? { description: addForm.description.trim() } : {}),
        ...(addForm.sort_order ? { sort_order: parseInt(addForm.sort_order, 10) } : {}),
        ...(addForm.parent_id !== "none" ? { parent_id: addForm.parent_id } : {}),
        ...(addForm.default_hourly_rate ? { default_hourly_rate: parseFloat(addForm.default_hourly_rate) } : {}),
        is_active: addForm.is_active,
      })
      toast.success("Category created")
      setAddForm(defaultFormState)
    } catch (error: unknown) {
      toast.error((error as Error).message || "Failed to create category")
    } finally {
      setIsAddPending(false)
    }
  }

  // ── Edit handlers ──
  const handleEditOpen = (category: CategoryRow) => {
    setEditCategory(category)
    setEditForm({
      name: category.name,
      description: category.description ?? "",
      sort_order: category.sort_order != null ? String(category.sort_order) : "",
      parent_id: category.parent_id ?? "none",
      default_hourly_rate: category.default_hourly_rate != null ? String(category.default_hourly_rate) : "",
      is_active: category.is_active,
    })
    setIsEditOpen(true)
  }

  const handleEditSave = async () => {
    if (!editCategory || !editForm.name.trim()) return
    try {
      await updateMutation.mutateAsync({
        id: editCategory.id,
        data: {
          name: editForm.name.trim(),
          ...(editForm.description.trim() ? { description: editForm.description.trim() } : { description: "" }),
          ...(editForm.sort_order ? { sort_order: parseInt(editForm.sort_order, 10) } : {}),
          ...(editForm.parent_id !== "none" ? { parent_id: editForm.parent_id } : { parent_id: null }),
          ...(editForm.default_hourly_rate
            ? { default_hourly_rate: parseFloat(editForm.default_hourly_rate) }
            : { default_hourly_rate: null }),
          is_active: editForm.is_active,
        },
      })
      toast.success("Category updated")
      setIsEditOpen(false)
      setEditCategory(null)
    } catch (error: unknown) {
      toast.error((error as Error).message || "Failed to update category")
    }
  }

  // ── Context menu / delete handlers ──
  const handleContextMenu = (e: React.MouseEvent, category: CategoryRow) => {
    e.preventDefault()
    setContextMenu({
      categoryId: category.id,
      categoryName: category.name,
      x: e.clientX,
      y: e.clientY,
    })
  }

  const handleDeleteClick = () => {
    if (!contextMenu) return
    const found = flatCategories.find(c => c.id === contextMenu.categoryId)
    if (found) {
      setDeleteTarget(found)
      setIsDeleteOpen(true)
    }
    setContextMenu(null)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Category deleted")
    } catch (error: unknown) {
      toast.error((error as Error).message || "Failed to delete category")
    } finally {
      setIsDeleteOpen(false)
      setDeleteTarget(null)
    }
  }

  // ── Active toggle ──
  const handleActiveToggle = async (category: CategoryRow) => {
    try {
      await updateMutation.mutateAsync({
        id: category.id,
        data: { is_active: !category.is_active },
      })
      toast.success(category.is_active ? "Category deactivated" : "Category activated")
    } catch {
      toast.error("Failed to update status")
    }
  }

  // ── Inline rate save ──
  const handleRateSave = async (id: string, rate: number | null) => {
    try {
      await updateMutation.mutateAsync({
        id,
        data: { default_hourly_rate: rate ?? null },
      })
      toast.success("Hourly rate updated")
    } catch {
      toast.error("Failed to update hourly rate")
    }
  }

  // ── Drag handlers ──
  const handleDragStart = (id: string) => setDraggingId(id)
  const handleDragEnd = () => {
    setDraggingId(null)
    setDragOverId(null)
  }
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    setDragOverId(id)
  }

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggingId || draggingId === targetId) {
      handleDragEnd()
      return
    }

    const draggingCat = flatCategories.find(c => c.id === draggingId)
    const targetCat = flatCategories.find(c => c.id === targetId)

    if (!draggingCat || !targetCat) {
      handleDragEnd()
      return
    }

    // Only allow reordering within the same parent level
    if (draggingCat.parent_id !== targetCat.parent_id) {
      handleDragEnd()
      return
    }

    const list: CategoryRow[] =
      draggingCat.parent_id === null
        ? categories
        : categories.find(c => c.id === draggingCat.parent_id)?.children ?? []

    const fromIdx = list.findIndex(c => c.id === draggingId)
    const toIdx = list.findIndex(c => c.id === targetId)

    if (fromIdx < 0 || toIdx < 0) {
      handleDragEnd()
      return
    }

    const reordered = [...list]
    reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, draggingCat)

    try {
      // Process in chunks of 10 to avoid overwhelming the API with concurrent requests
      const chunkSize = 10
      for (let i = 0; i < reordered.length; i += chunkSize) {
        const chunk = reordered.slice(i, i + chunkSize)
        await Promise.all(
          chunk.map((cat, relIdx) =>
            updateMutation.mutateAsync({
              id: cat.id,
              data: { sort_order: (i + relIdx + 1) * 10 },
            }),
          ),
        )
      }
      toast.success("Order updated")
    } catch {
      toast.error("Failed to update order")
    }

    handleDragEnd()
  }

  const dragProps: DragProps = {
    dragging: draggingId,
    over: dragOverId,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* ── Tree ── */}
      <div className="md:col-span-2 space-y-4">
        <div>
          <h3 className="text-lg font-medium">Labor Categories</h3>
          <p className="text-sm text-slate-500">
            Manage hierarchical labor categories with hourly rates. Right-click a row to delete.
          </p>
        </div>

        <Card>
          <CardContent className="p-4">
            {isLoading ? (
              <div className="flex items-center justify-center p-8 text-slate-500">
                <Loader2 className="animate-spin h-6 w-6 mr-2" /> Loading categories...
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center p-8 text-slate-500">
                No categories found. Create your first category using the form.
              </div>
            ) : (
              <div className="space-y-0.5">
                {categories.map(cat => (
                  <CategoryTreeRow
                    key={cat.id}
                    category={cat}
                    topLevelCategories={categories}
                    onEdit={handleEditOpen}
                    onContextMenu={handleContextMenu}
                    onActiveToggle={handleActiveToggle}
                    onRateSave={handleRateSave}
                    dragProps={dragProps}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Add Category Form ── */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Category
            </CardTitle>
            <CardDescription>Create a new labor category.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={e => void handleAdd(e)} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Engine Repair"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Input
                  value={addForm.description}
                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Parent Category</label>
                <Select
                  value={addForm.parent_id}
                  onValueChange={val => setAddForm(f => ({ ...f, parent_id: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None (Top Level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Top Level)</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Default Hourly Rate</label>
                <Input
                  value={addForm.default_hourly_rate}
                  onChange={e => setAddForm(f => ({ ...f, default_hourly_rate: e.target.value }))}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 850.00"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Sort Order</label>
                <Input
                  value={addForm.sort_order}
                  onChange={e => setAddForm(f => ({ ...f, sort_order: e.target.value }))}
                  type="number"
                  min="0"
                  placeholder="e.g. 10"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Active</label>
                <button
                  type="button"
                  onClick={() => setAddForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={cn(
                    "text-xs px-3 py-1 rounded-full border font-medium transition-colors",
                    addForm.is_active
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                      : "bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200",
                  )}
                >
                  {addForm.is_active ? "Active" : "Inactive"}
                </button>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isAddPending || createMutation.isPending || !addForm.name.trim()}
              >
                {(isAddPending || createMutation.isPending) && (
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                )}
                <Plus className="mr-2 h-4 w-4" />
                Add Category
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border rounded-md shadow-lg py-1 min-w-[130px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-sm text-left text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleDeleteClick}
          >
            Delete
          </button>
        </div>
      )}

      {/* ── Edit Dialog ── */}
      <AlertDialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Category</AlertDialogTitle>
            <AlertDialogDescription>
              Update the details for <strong>{editCategory?.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={editForm.description}
                onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Parent Category</label>
              <Select
                value={editForm.parent_id}
                onValueChange={val => setEditForm(f => ({ ...f, parent_id: val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (Top Level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Top Level)</SelectItem>
                  {categories
                    .filter(cat => cat.id !== editCategory?.id)
                    .map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Default Hourly Rate</label>
              <Input
                value={editForm.default_hourly_rate}
                onChange={e => setEditForm(f => ({ ...f, default_hourly_rate: e.target.value }))}
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 850.00"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Sort Order</label>
              <Input
                value={editForm.sort_order}
                onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))}
                type="number"
                min="0"
                placeholder="e.g. 10"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Active</label>
              <button
                type="button"
                onClick={() => setEditForm(f => ({ ...f, is_active: !f.is_active }))}
                className={cn(
                  "text-xs px-3 py-1 rounded-full border font-medium transition-colors",
                  editForm.is_active
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                    : "bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200",
                )}
              >
                {editForm.is_active ? "Active" : "Inactive"}
              </button>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleEditSave()}
              disabled={updateMutation.isPending || !editForm.name.trim()}
            >
              {updateMutation.isPending && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Confirmation Dialog ── */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  Are you sure you want to delete{" "}
                  <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
                </p>
                {deleteTarget && deleteTarget.children.length > 0 && (
                  <p className="mt-2 text-amber-600">
                    This category has {deleteTarget.children.length} child{" "}
                    {deleteTarget.children.length === 1 ? "category" : "categories"} which may also
                    be affected.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteConfirm()}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

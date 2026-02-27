import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'DONE'
type LineItemType = 'LABOR' | 'PART'

interface TaskLineItem {
  id: string
  type: LineItemType
  itemNo: string
  description: string
  qty: number
  unitPrice: number
}

interface RepairTask {
  id: string
  title: string
  done: boolean
  status: TaskStatus
  lineItems: TaskLineItem[]
  mechanicNotes: string
}

interface TaskDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: RepairTask | null
  onTaskStatusChange: (taskId: string, status: TaskStatus) => void
  onTaskLineItemsChange: (taskId: string, items: TaskLineItem[]) => void
  onTaskMechanicNotesChange: (taskId: string, notes: string) => void
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function TaskDetailDrawer({
  open,
  onOpenChange,
  task,
  onTaskStatusChange,
  onTaskLineItemsChange,
  onTaskMechanicNotesChange,
}: TaskDetailDrawerProps) {
  const [newType, setNewType] = useState<LineItemType>('PART')
  const [newItemNo, setNewItemNo] = useState('')
  const [newQty, setNewQty] = useState('1')
  const itemInputRef = useRef<HTMLInputElement | null>(null)

  const taskTitle = task?.title ?? 'Task Detail'
  const items = task?.lineItems ?? []
  const subtotal = items.reduce((acc, item) => acc + item.qty * item.unitPrice, 0)

  function appendQuickItem() {
    if (!task) return

    const itemNo = newItemNo.trim()
    const qty = Number(newQty)
    if (!itemNo || !Number.isFinite(qty) || qty <= 0) return

    const next: TaskLineItem = {
      id: `li-${task.id}-${items.length + 1}`,
      type: newType,
      itemNo,
      description: newType === 'LABOR' ? 'Labor line item' : 'Part line item',
      qty,
      unitPrice: newType === 'LABOR' ? 95 : 35,
    }

    onTaskLineItemsChange(task.id, [...items, next])
    setNewItemNo('')
    setNewQty('1')
    requestAnimationFrame(() => itemInputRef.current?.focus())
  }

  function handleQuickAddKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    appendQuickItem()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] p-0">
        <div className="h-full flex flex-col">
          <SheetHeader className="px-6 py-5 border-b">
            <div className="pr-8 space-y-3">
              <SheetTitle className="text-lg font-semibold tracking-tight">{taskTitle}</SheetTitle>
              <div className="w-[220px]">
                <Select
                  value={task?.status ?? 'IN_PROGRESS'}
                  onValueChange={(v) => {
                    if (!task) return
                    onTaskStatusChange(task.id, v as TaskStatus)
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT_STARTED">Not Started</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="WAITING_PARTS">Waiting Parts</SelectItem>
                    <SelectItem value="DONE">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <SheetDescription className="text-xs">
                Task details, labor lines, parts, and mechanic notes.
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-hidden px-6 py-4">
            <Tabs defaultValue="labor-parts" className="h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="labor-parts">Labor & Parts</TabsTrigger>
                <TabsTrigger value="mechanic-notes">Mechanic Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="labor-parts" className="mt-4 flex-1 min-h-0">
                <div className="h-full min-h-[440px] border rounded-xl relative pb-[74px]">
                  <div className="h-full overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[84px] text-xs">Type</TableHead>
                          <TableHead className="text-xs">Item No.</TableHead>
                          <TableHead className="text-xs">Description</TableHead>
                          <TableHead className="w-[54px] text-xs">Qty</TableHead>
                          <TableHead className="w-[96px] text-xs">Unit Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <Badge variant={item.type === 'LABOR' ? 'secondary' : 'outline'}>
                                {item.type === 'LABOR' ? 'Labor' : 'Part'}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{item.itemNo}</TableCell>
                            <TableCell className="text-muted-foreground">{item.description}</TableCell>
                            <TableCell>{item.qty}</TableCell>
                            <TableCell>{formatMoney(item.unitPrice)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="absolute left-0 right-0 bottom-0 border-t bg-muted/40 px-3 py-2">
                    <div className="grid grid-cols-[98px_1fr_70px] gap-2">
                      <Select value={newType} onValueChange={(v) => setNewType(v as LineItemType)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LABOR">Labor</SelectItem>
                          <SelectItem value="PART">Part</SelectItem>
                        </SelectContent>
                      </Select>

                      <Input
                        ref={itemInputRef}
                        value={newItemNo}
                        onChange={(e) => setNewItemNo(e.target.value)}
                        onKeyDown={handleQuickAddKeyDown}
                        placeholder="Search item or type item no..."
                        className="h-8 text-xs"
                      />

                      <Input
                        value={newQty}
                        onChange={(e) => setNewQty(e.target.value)}
                        onKeyDown={handleQuickAddKeyDown}
                        placeholder="Qty"
                        className="h-8 text-xs text-right"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  {items.length} lines · Subtotal {formatMoney(subtotal)}
                </div>
              </TabsContent>

              <TabsContent value="mechanic-notes" className="mt-4 flex-1">
                <textarea
                  className="w-full min-h-[460px] rounded-xl border p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Mechanic observations, measurements, and service notes..."
                  value={task?.mechanicNotes ?? ''}
                  onChange={(e) => {
                    if (!task) return
                    onTaskMechanicNotesChange(task.id, e.target.value)
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

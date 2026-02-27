import { useEffect, useMemo, useRef, useState } from 'react'
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
  status: TaskStatus
}

interface TaskDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: RepairTask | null
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function TaskDetailDrawer({ open, onOpenChange, task }: TaskDetailDrawerProps) {
  const [status, setStatus] = useState<TaskStatus>('IN_PROGRESS')
  const [items, setItems] = useState<TaskLineItem[]>([
    {
      id: 'li-1',
      type: 'LABOR',
      itemNo: 'LAB-001',
      description: 'Diagnostic and inspection',
      qty: 1,
      unitPrice: 120,
    },
    {
      id: 'li-2',
      type: 'PART',
      itemNo: 'BRK-PAD-F',
      description: 'Front brake pads set',
      qty: 1,
      unitPrice: 189,
    },
  ])
  const [newType, setNewType] = useState<LineItemType>('PART')
  const [newItemNo, setNewItemNo] = useState('')
  const [newQty, setNewQty] = useState('1')
  const itemInputRef = useRef<HTMLInputElement | null>(null)

  const taskTitle = task?.title ?? 'Task Detail'

  useEffect(() => {
    if (task) setStatus(task.status)
  }, [task])

  const totals = useMemo(() => {
    const total = items.reduce((acc, item) => acc + item.qty * item.unitPrice, 0)
    return {
      total,
      count: items.length,
    }
  }, [items])

  function appendQuickItem() {
    const itemNo = newItemNo.trim()
    const qty = Number(newQty)
    if (!itemNo || !Number.isFinite(qty) || qty <= 0) return

    const next: TaskLineItem = {
      id: `li-${Date.now()}`,
      type: newType,
      itemNo,
      description: newType === 'LABOR' ? 'Labor line item' : 'Part line item',
      qty,
      unitPrice: newType === 'LABOR' ? 95 : 35,
    }

    setItems((current) => [...current, next])
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
      <SheetContent side="right" className="w-full sm:max-w-[480px] p-0 bg-white border-slate-200">
        <div className="h-full flex flex-col">
          <SheetHeader className="px-6 py-5 border-b border-slate-200">
            <div className="pr-8 space-y-3">
              <SheetTitle className="text-lg font-semibold tracking-tight">{taskTitle}</SheetTitle>
              <div className="w-[220px]">
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger className="h-9 text-xs border-slate-300">
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
              <SheetDescription className="text-xs text-slate-500">
                Task details, labor lines, parts, and mechanic notes.
              </SheetDescription>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-hidden px-6 py-4">
            <Tabs defaultValue="labor-parts" className="h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-2 bg-slate-100">
                <TabsTrigger value="labor-parts">Labor & Parts</TabsTrigger>
                <TabsTrigger value="mechanic-notes">Mechanic Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="labor-parts" className="mt-4 flex-1 min-h-0">
                <div className="h-full min-h-[440px] border border-slate-200 rounded-xl bg-white relative pb-[74px]">
                  <div className="h-full overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow className="hover:bg-white">
                          <TableHead className="w-[84px] text-xs text-slate-500">Type</TableHead>
                          <TableHead className="text-xs text-slate-500">Item No.</TableHead>
                          <TableHead className="text-xs text-slate-500">Description</TableHead>
                          <TableHead className="w-[54px] text-xs text-slate-500">Qty</TableHead>
                          <TableHead className="w-[96px] text-xs text-slate-500">Unit Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => (
                          <TableRow key={item.id} className="hover:bg-slate-50">
                            <TableCell>
                              <Badge
                                className={
                                  item.type === 'LABOR'
                                    ? 'bg-violet-100 text-violet-700 hover:bg-violet-100'
                                    : 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                                }
                              >
                                {item.type === 'LABOR' ? 'Labor' : 'Part'}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium text-slate-700">{item.itemNo}</TableCell>
                            <TableCell className="text-slate-600">{item.description}</TableCell>
                            <TableCell>{item.qty}</TableCell>
                            <TableCell>{formatMoney(item.unitPrice)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="absolute left-0 right-0 bottom-0 border-t border-blue-100 bg-blue-50/50 px-3 py-2">
                    <div className="grid grid-cols-[98px_1fr_70px] gap-2">
                      <Select value={newType} onValueChange={(v) => setNewType(v as LineItemType)}>
                        <SelectTrigger className="h-8 bg-white border-blue-200 text-xs">
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
                        className="h-8 bg-white border-blue-200 text-xs"
                      />

                      <Input
                        value={newQty}
                        onChange={(e) => setNewQty(e.target.value)}
                        onKeyDown={handleQuickAddKeyDown}
                        placeholder="Qty"
                        className="h-8 bg-white border-blue-200 text-xs text-right"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  {totals.count} lines · Subtotal {formatMoney(totals.total)}
                </div>
              </TabsContent>

              <TabsContent value="mechanic-notes" className="mt-4 flex-1">
                <textarea
                  className="w-full min-h-[460px] rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Mechanic observations, measurements, and service notes..."
                  defaultValue="Pads are worn unevenly on front axle. Rotor runout measured at 0.08mm. Recommend replacing front pads and resurfacing rotors."
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

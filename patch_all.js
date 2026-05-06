const fs = require('fs');

// apps/core-api/src/purchase/dto/update-purchase-order.dto.ts
const dtoPath = 'apps/core-api/src/purchase/dto/update-purchase-order.dto.ts';
fs.writeFileSync(dtoPath, `import { IsOptional, IsString } from 'class-validator';

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsString()
  notes?: string;
}`);

// apps/core-api/src/purchase/purchase.controller.ts
const controllerPath = 'apps/core-api/src/purchase/purchase.controller.ts';
let code = fs.readFileSync(controllerPath, 'utf8');

const importReplace = `import { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';\nimport { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';`;
if(!code.includes('UpdatePurchaseOrderDto')) {
    code = code.replace(`import { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';`, importReplace);
}

const methodSearch = `  @Delete(':id')
  async remove(@Param('id') id: string) {`;
const methodReplace = `  @Patch(':id')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  async updatePurchaseOrder(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseService.updatePurchaseOrder(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {`;

if(!code.includes('updatePurchaseOrder(')) {
    code = code.replace(methodSearch, methodReplace);
}

fs.writeFileSync(controllerPath, code);

// apps/core-api/src/purchase/purchase.service.ts
const servicePath = 'apps/core-api/src/purchase/purchase.service.ts';
code = fs.readFileSync(servicePath, 'utf8');

const serviceImportReplace = `import { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';\nimport { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';`;

if(!code.includes('UpdatePurchaseOrderDto')) {
    code = code.replace(`import { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';`, serviceImportReplace);
}

const serviceMethodSearch = `  async remove(id: string) {`;
const serviceMethodReplace = `  async updatePurchaseOrder(id: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Purchase order not found');

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {`;

if(!code.includes('updatePurchaseOrder(')) {
    code = code.replace(serviceMethodSearch, serviceMethodReplace);
}

fs.writeFileSync(servicePath, code);

// apps/core-web/src/api/purchase-orders.ts
const webApiPath = 'apps/core-web/src/api/purchase-orders.ts';
code = fs.readFileSync(webApiPath, 'utf8');

const webApiSearch = `export function usePurchaseOrder(id: string) {`;
const webApiReplace = `export function useUpdatePurchaseOrder() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: { notes?: string } }) => {
            const res = await fetchWithAuth(\`\${PO_API}/\${id}\`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            })
            if (!res.ok) throw new Error('Failed to update PO')
            return res.json()
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.detail(variables.id) })
            queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all })
        },
    })
}

export function usePurchaseOrder(id: string) {`;

if(!code.includes('useUpdatePurchaseOrder')) {
    code = code.replace(webApiSearch, webApiReplace);
}

fs.writeFileSync(webApiPath, code);


// apps/core-web/src/api/types.ts
const typesPath = 'apps/core-web/src/api/types.ts';
code = fs.readFileSync(typesPath, 'utf8');

const typesSearch = `export interface PurchaseOrder {
    id: string
    vendor_id: string
    vendor: Vendor
    status: PurchaseOrderStatus
    order_number: string
    items: PurchaseOrderItem[]
    createdAt: string
}`;

const typesReplace = `export interface PurchaseOrder {
    id: string
    vendor_id: string
    vendor: Vendor
    status: PurchaseOrderStatus
    order_number: string
    items: PurchaseOrderItem[]
    createdAt: string
    notes?: string
}`;

if(!code.includes('notes?: string', code.indexOf('export interface PurchaseOrder {'))) {
    code = code.replace(typesSearch, typesReplace);
}

fs.writeFileSync(typesPath, code);

// apps/core-api/prisma/schema.prisma
const prismaPath = 'apps/core-api/prisma/schema.prisma';
code = fs.readFileSync(prismaPath, 'utf8');

const prismaSearch = `model PurchaseOrder {
  id           String              @id @default(uuid())
  tenant_id    String
  tenant       Tenant              @relation(fields: [tenant_id], references: [id])
  vendor_id    String
  vendor       Vendor              @relation(fields: [vendor_id], references: [id])
  status       PurchaseOrderStatus @default(DRAFT)
  order_number String
  items        PurchaseOrderItem[]`;

const prismaReplace = `model PurchaseOrder {
  id           String              @id @default(uuid())
  tenant_id    String
  tenant       Tenant              @relation(fields: [tenant_id], references: [id])
  vendor_id    String
  vendor       Vendor              @relation(fields: [vendor_id], references: [id])
  status       PurchaseOrderStatus @default(DRAFT)
  order_number String
  notes        String?
  items        PurchaseOrderItem[]`;

if(!code.includes('notes        String?', code.indexOf('model PurchaseOrder {'))) {
    code = code.replace(prismaSearch, prismaReplace);
}

fs.writeFileSync(prismaPath, code);

// apps/core-web/src/pages/purchase-orders/PurchaseOrderDetail.tsx
const pagePath = 'apps/core-web/src/pages/purchase-orders/PurchaseOrderDetail.tsx';
code = fs.readFileSync(pagePath, 'utf8');

const importPageSearch = `import { usePurchaseOrder, useReceiveGoods, useAddPOItems, useUpdatePOItem, useDeletePOItem } from '@/api/purchase-orders'`;
const importPageReplace = `import { usePurchaseOrder, useReceiveGoods, useAddPOItems, useUpdatePOItem, useDeletePOItem, useUpdatePurchaseOrder } from '@/api/purchase-orders'`;

if(!code.includes('useUpdatePurchaseOrder')) {
    code = code.replace(importPageSearch, importPageReplace);
}

const uiPageSearch = `                <div className="space-y-6 lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Purchase Order</CardTitle>`;
const uiPageReplace = `                <div className="space-y-6 lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Order Notes</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <PONotesInput po={po} id={id} />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base font-semibold">Purchase Order</CardTitle>`;

const componentCode = `
function PONotesInput({ po, id }: { po: PurchaseOrder, id: string }) {
    const [notes, setNotes] = useState(po.notes || '')
    const [isSaving, setIsSaving] = useState(false)
    const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | ''>('')
    const updatePO = useUpdatePurchaseOrder()
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        setNotes(po.notes || '')
    }, [po.notes])

    const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newNotes = e.target.value
        setNotes(newNotes)
        setSaveStatus('saving')

        if (typingTimeoutRef.current) {
            window.clearTimeout(typingTimeoutRef.current)
        }

        typingTimeoutRef.current = window.setTimeout(() => {
            setIsSaving(true)
            updatePO.mutate({
                id,
                updates: { notes: newNotes }
            }, {
                onSuccess: () => {
                    setSaveStatus('saved')
                    setIsSaving(false)
                    setTimeout(() => setSaveStatus(''), 2000)
                },
                onError: (error) => {
                    setSaveStatus('error')
                    setIsSaving(false)
                    toast.error('Failed to auto-save notes', { description: error.message })
                }
            })
        }, 1000) // 1 second debounce
    }

    return (
        <div className="space-y-2 relative">
            <label htmlFor="notes-input" className="sr-only block text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Notes</label>
            <textarea
                id="notes-input"
                aria-label="Notes" name="Notes" title="Notes"
                value={notes}
                onChange={handleNotesChange}
                placeholder="Add notes..."
                className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            {saveStatus && (
                <div className="absolute bottom-2 right-3 text-xs flex items-center">
                    {saveStatus === 'saving' && <span className="text-muted-foreground animate-pulse">Saving...</span>}
                    {saveStatus === 'saved' && <span className="text-green-500">Saved</span>}
                    {saveStatus === 'error' && <span className="text-red-500">Error saving</span>}
                </div>
            )}
        </div>
    )
}
`;


if(!code.includes('PONotesInput(')) {
    const splitIndex = code.indexOf('export default function PurchaseOrderDetail() {');
    code = code.substring(0, splitIndex) + componentCode + code.substring(splitIndex);
}

if(!code.includes('<PONotesInput po={po} id={id} />')) {
    code = code.replace(uiPageSearch, uiPageReplace);
}

fs.writeFileSync(pagePath, code);

// apps/core-web/e2e/purchase-order-detail.spec.ts
const e2ePath = 'apps/core-web/e2e/purchase-order-detail.spec.ts';
code = fs.readFileSync(e2ePath, 'utf8');
code = code.replace(`test.fixme('Purchase Order Detail - auto-save on field change'`, `test('Purchase Order Detail - auto-save on field change'`);
code = code.replace(`const notesInput = page.getByLabel(/Notes/i)`, `const notesInput = page.getByPlaceholder('Add notes...')`);

fs.writeFileSync(e2ePath, code);

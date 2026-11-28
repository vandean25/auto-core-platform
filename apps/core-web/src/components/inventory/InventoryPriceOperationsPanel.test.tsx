import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import * as priceOpsApi from '@/api/inventory-price-operations'
import type { InventoryPriceOperationDto } from '@/api/inventory-price-operations'
import deInventory from '../../../../../locales/de/inventory.json'
import { InventoryPriceOperationsPanel } from './InventoryPriceOperationsPanel'

vi.mock('@/api/inventory-price-operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/inventory-price-operations')>()),
  useInventoryPriceOperationsDiscovery: vi.fn(),
  useFenceInventoryPriceOperation: vi.fn(),
}))

function makeOp(key: string, sku: string, state: InventoryPriceOperationDto['state'] = 'APPLIED'): InventoryPriceOperationDto {
  return {
    key,
    itemId: `item-${key}`,
    sku,
    state,
    kind: 'RETAIL_PRICE',
    expectedRevision: 1,
    retail_price: '12.00',
    basis_retail_price: '10.00',
    acceptedAt: '2026-10-01T10:00:00.000Z',
    finalAt: state === 'ACCEPTED' ? null : '2026-10-01T10:00:05.000Z',
    errorCode: null,
  }
}

describe('InventoryPriceOperationsPanel (AUT-1063)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('WHEN price changes render THEN mark-as-seen is an icon action, SKU is truncated, and APPLIED uses StatusBadge', () => {
    vi.mocked(priceOpsApi.useInventoryPriceOperationsDiscovery).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              makeOp('op-1', 'VERY-LONG-SUPPLIER-SKU-0001'),
              makeOp('op-2', 'VERY-LONG-SUPPLIER-SKU-0002'),
            ],
            meta: { next_cursor: null },
          },
        ],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as never)
    vi.mocked(priceOpsApi.useFenceInventoryPriceOperation).mockReturnValue({
      mutateAsync: vi.fn(),
    } as never)

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <InventoryPriceOperationsPanel enabled />
        </TooltipProvider>
      </QueryClientProvider>,
    )

    const markSeenButtons = screen.getAllByRole('button', { name: deInventory.bulk.adjustPrice.discovery.markSeen })
    expect(markSeenButtons).toHaveLength(2)
    for (const button of markSeenButtons) {
      expect(button.textContent).toBe('')
    }

    const skuEl = screen.getByText('VERY-LONG-SUPPLIER-SKU-0001')
    expect(skuEl).toHaveClass('truncate')
    expect(skuEl).toHaveAttribute('title', 'VERY-LONG-SUPPLIER-SKU-0001')

    const appliedBadges = screen.getAllByText(deInventory.bulk.adjustPrice.states.applied)
    expect(appliedBadges[0]).toHaveClass('border-success/30', 'bg-success/10', 'text-success')

    fireEvent.click(markSeenButtons[0])
    expect(screen.queryByText('VERY-LONG-SUPPLIER-SKU-0001')).not.toBeInTheDocument()
    expect(screen.getByText('VERY-LONG-SUPPLIER-SKU-0002')).toBeInTheDocument()
  })
})

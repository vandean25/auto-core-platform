import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useMySites } from '@/api/sites'
import { useAuthSession } from '@/api/auth-session'
import { useWorkshopKpiReport, type WorkshopKpiReport, type WorkshopKpiReportRow } from '@/api/workshop-kpi-reports'
import WorkshopKpiReportsPage, { serializeWorkshopKpiCsv } from './WorkshopKpiReportsPage'

vi.mock('@/api/sites', () => ({ useMySites: vi.fn() }))
vi.mock('@/api/auth-session', () => ({ useAuthSession: vi.fn() }))
vi.mock('@/api/workshop-kpi-reports', () => ({ useWorkshopKpiReport: vi.fn() }))

const row: WorkshopKpiReportRow = {
  key: 'm1', period: '2026-01', mechanic_id: 'm1', mechanic_name: 'Müller',
  available_hours: '10.00', clocked_hours: '7.50', sold_hours: '6.00', labor_net_revenue: '100.00', parts_net_revenue: '25.50',
  utilisation_percent: '75.00', productivity_percent: '80.00', closed_orders: 2,
  average_net_revenue_per_order: '125.50', open_labor_entry_count: 0,
}

const reportData: WorkshopKpiReport = {
  data: [row],
  totals: { ...row, key: 'total', mechanic_id: null, mechanic_name: null },
  meta: { from: '2026-01-01', to: '2026-01-31', timezone: 'Europe/Vienna', groupBy: 'mechanic', unassigned_mechanic_count: 0 },
  parts_turnover: {
    issued_cost: '40.00', average_stock_value: '200.00', turnover: '0.20',
    unvalued_stock_item_count: 0,
    slow_movers: [{ catalog_item_id: 'part-1', sku: 'FILTER-1', name: 'Filter; Öl', quantity_on_hand: '2.000', stock_value: '40.00', days_since_last_issue: 120 }],
  },
}

describe('WorkshopKpiReportsPage', () => {
  it('renders empty data without errors', () => {
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1' } } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({ isLoading: false, isError: false, data: undefined } as never)
    render(<MemoryRouter><WorkshopKpiReportsPage /></MemoryRouter>)
    expect(screen.getByText('Keine Daten für den ausgewählten Zeitraum.')).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(useWorkshopKpiReport).toHaveBeenCalledWith(expect.objectContaining({ siteId: 'site-1', groupBy: 'mechanic' }))
  })

  it('formats displayed percentages in German and exports matching decimal-point values', () => {
    vi.mocked(useMySites).mockReturnValue({ data: [{ id: 'site-1', name: 'Wien' }] } as never)
    vi.mocked(useAuthSession).mockReturnValue({ data: { activeSiteId: 'site-1' } } as never)
    vi.mocked(useWorkshopKpiReport).mockReturnValue({
      isLoading: false, isError: false,
      data: reportData,
    } as never)
    render(<MemoryRouter><WorkshopKpiReportsPage /></MemoryRouter>)
    expect(screen.getAllByText('75,00 %')).toHaveLength(2)
    expect(serializeWorkshopKpiCsv(reportData)).toContain('10.00;7.50;6.00;100.00;25.50;75.00;80.00')
  })

  it('exports parts turnover and slow movers with the work performance rows', () => {
    const csv = serializeWorkshopKpiCsv(reportData)

    expect(csv).toContain('40.00;200.00;0.20;0')
    expect(csv).toContain('FILTER-1;"Filter; Öl";2.000;40.00;120')
  })
})

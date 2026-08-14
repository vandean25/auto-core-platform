import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditLog } from '@/api/audit'
import { AuditLogsTab } from './AuditLogsTab'

const mockAuditLogs: AuditLog[] = [
  {
    id: 'audit-1',
    tenantId: 'tenant-123',
    entityType: 'Customer',
    entityId: 'cust-uuid-1',
    action: 'UPDATE',
    actorUserId: 'user-uuid-1',
    actorEmail: 'admin@autocore.test',
    actorRole: 'ADMIN',
    actorType: 'USER',
    requestId: 'req-abc-123',
    source: 'API',
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 Chrome/120',
    before: { first_name: 'John', last_name: 'Doe' },
    after: { first_name: 'Johnny', last_name: 'Doe' },
    diff: { first_name: { before: 'John', after: 'Johnny' } },
    changedFields: ['first_name'],
    redactedFields: ['password'],
    occurredAt: '2026-08-14T10:00:00.000Z',
  },
]

vi.mock('@/api/audit', () => ({
  useAuditLogs: vi.fn(() => ({
    data: {
      data: mockAuditLogs,
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    },
    isLoading: false,
  })),
}))

vi.mock('@/components/data-table/DataTable', () => ({
  DataTable: ({
    data,
    onRowClick,
  }: {
    data: AuditLog[]
    onRowClick?: (row: AuditLog) => void
  }) => (
    <div data-testid="mock-data-table">
      {data.map((log) => (
        <button key={log.id} type="button" onClick={() => onRowClick?.(log)}>
          {log.entityType} - {log.entityId}
        </button>
      ))}
    </div>
  ),
}))

describe('AuditLogsTab', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders header, subtitle, action filter and audit logs table', () => {
    render(
      <MemoryRouter>
        <AuditLogsTab />
      </MemoryRouter>,
    )

    expect(screen.getByText('Audit Logs')).toBeInTheDocument()
    expect(
      screen.getByText('Immutable, append-only audit trail of business entity mutations and deletions.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('mock-data-table')).toBeInTheDocument()
    expect(screen.getByText('Customer - cust-uuid-1')).toBeInTheDocument()
  })

  it('opens detail Sheet on row click and displays audit context and diff', async () => {
    render(
      <MemoryRouter>
        <AuditLogsTab />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('Customer - cust-uuid-1'))

    await waitFor(() => {
      expect(screen.getByText('Audit Record Details')).toBeInTheDocument()
    })

    expect(screen.getByText('Target ID: cust-uuid-1')).toBeInTheDocument()
    expect(screen.getByText('admin@autocore.test')).toBeInTheDocument()
    expect(screen.getByText('req-abc-123')).toBeInTheDocument()
    expect(screen.getByText('password')).toBeInTheDocument()
  })
})

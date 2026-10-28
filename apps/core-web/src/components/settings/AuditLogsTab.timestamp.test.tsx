import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditLogsTab } from './AuditLogsTab'

vi.mock('@/api/audit', () => ({
  useAuditLogs: () => ({
    data: {
      data: [
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
          ipAddress: null,
          userAgent: null,
          before: null,
          after: null,
          diff: null,
          changedFields: [],
          redactedFields: [],
          occurredAt: '2026-08-14T10:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    },
    isLoading: false,
  }),
}))

vi.mock('@/api/workshop', () => ({
  useWorkshopSettings: () => ({ data: { timezone: 'Europe/Vienna' } }),
}))

describe('AuditLogsTab timestamp column', () => {
  afterEach(cleanup)

  it('shows the time in the workshop time zone once, without the raw ISO string under it', () => {
    render(
      <MemoryRouter>
        <AuditLogsTab />
      </MemoryRouter>,
    )

    const table = screen.getByRole('table')
    expect(within(table).getByText('2026-08-14 12:00:00')).toBeInTheDocument()
    expect(within(table).queryByText('2026-08-14T10:00:00.000Z')).not.toBeInTheDocument()
  })
})

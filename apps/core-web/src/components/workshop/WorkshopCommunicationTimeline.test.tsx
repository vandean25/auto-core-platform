import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as communicationsApi from '@/api/workshop-communications'
import type { WorkshopOrderCommunication } from '@/api/workshop-communications'
import { WorkshopCommunicationTimeline, describeCommunication } from './WorkshopCommunicationTimeline'

vi.mock('@/api/workshop-communications', async () => {
  const actual = await vi.importActual<typeof import('@/api/workshop-communications')>('@/api/workshop-communications')
  return { ...actual, useWorkshopOrderCommunications: vi.fn() }
})

const useCommunications = vi.mocked(communicationsApi.useWorkshopOrderCommunications)

function entry(overrides: Partial<WorkshopOrderCommunication> = {}): WorkshopOrderCommunication {
  return {
    id: 'outbox-1',
    kind: 'ESTIMATE_EMAIL',
    channel: 'EMAIL',
    version: 1,
    occurred_at: '2026-10-10T08:05:00.000Z',
    status: 'SENT',
    decision: null,
    ...overrides,
  }
}

/** The hook's result for one state. Only the fields the component reads are set. */
function queryState(state: { isPending?: boolean; isError?: boolean; data?: WorkshopOrderCommunication[]; refetch?: () => unknown }) {
  return {
    isPending: false,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
    ...state,
  } as unknown as ReturnType<typeof communicationsApi.useWorkshopOrderCommunications>
}

describe('WorkshopCommunicationTimeline', () => {
  beforeEach(() => {
    useCommunications.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('says the timeline is loading while the first read is pending', () => {
    useCommunications.mockReturnValue(queryState({ isPending: true }))

    render(<WorkshopCommunicationTimeline orderId="order-1" />)

    expect(screen.getByText('Kommunikation mit dem Kunden')).toBeInTheDocument()
    expect(screen.getByText('Kommunikation wird geladen …')).toBeInTheDocument()
  })

  it('offers a retry when the timeline cannot be read', () => {
    const refetch = vi.fn()
    useCommunications.mockReturnValue(queryState({ isError: true, refetch }))

    render(<WorkshopCommunicationTimeline orderId="order-1" />)

    // Under the card title (h2) the error title is h3, so the page outline has no skipped level.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Kommunikation konnte nicht geladen werden.' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says so when the customer has not been written to or decided yet', () => {
    useCommunications.mockReturnValue(queryState({ data: [] }))

    render(<WorkshopCommunicationTimeline orderId="order-1" />)

    expect(screen.getByText('Noch keine Kommunikation mit dem Kunden.')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('lists each entry in German, in the order it was given, with the time in Vienna', () => {
    useCommunications.mockReturnValue(
      queryState({
        data: [
          entry({
            id: 'approval-1',
            kind: 'ESTIMATE_APPROVAL',
            channel: 'LINK',
            decision: 'APPROVED',
            status: null,
            occurred_at: '2026-10-11T07:30:00.000Z',
          }),
          entry({ id: 'outbox-1', occurred_at: '2026-10-10T08:05:00.000Z' }),
        ],
      }),
    )

    render(<WorkshopCommunicationTimeline orderId="order-1" />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Kunde hat Kostenvoranschlag (Version 1) über den Link freigegeben')).toBeInTheDocument()
    expect(items[0]).toHaveTextContent('11.10.2026, 09:30')
    expect(within(items[1]).getByText('Kostenvoranschlag (Version 1) per E-Mail gesendet')).toBeInTheDocument()
    expect(items[1]).toHaveTextContent('10.10.2026, 10:05')
  })
})

describe('describeCommunication', () => {
  it.each<[WorkshopOrderCommunication, string]>([
    [entry({ status: 'QUEUED' }), 'Kostenvoranschlag (Version 1) wird per E-Mail versendet'],
    [entry({ status: 'SENT' }), 'Kostenvoranschlag (Version 1) per E-Mail gesendet'],
    [entry({ status: 'FAILED' }), 'E-Mail mit Kostenvoranschlag (Version 1) konnte nicht gesendet werden'],
    [entry({ status: 'SUPPRESSED' }), 'E-Mail mit Kostenvoranschlag (Version 1) wurde nicht gesendet'],
    [entry({ status: 'SENT', version: null }), 'Kostenvoranschlag per E-Mail gesendet'],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'LINK', decision: 'APPROVED', status: null }),
      'Kunde hat Kostenvoranschlag (Version 1) über den Link freigegeben',
    ],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'LINK', decision: 'DECLINED', status: null }),
      'Kunde hat Kostenvoranschlag (Version 1) über den Link abgelehnt',
    ],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'ADVISOR_RECORDED', decision: 'APPROVED', status: null }),
      'Freigabe von Kostenvoranschlag (Version 1) durch den Berater erfasst',
    ],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'ADVISOR_RECORDED', decision: 'DECLINED', status: null }),
      'Ablehnung von Kostenvoranschlag (Version 1) durch den Berater erfasst',
    ],
  ])('describes %j in German', (row, expected) => {
    expect(describeCommunication(row)).toBe(expected)
  })
})

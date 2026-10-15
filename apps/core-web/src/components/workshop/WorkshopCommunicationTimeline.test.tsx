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
    expect(within(items[0]).getByText('Der Kunde hat den Kostenvoranschlag (Version 1) über den Link freigegeben')).toBeInTheDocument()
    expect(items[0]).toHaveTextContent('11.10.2026, 09:30')
    expect(within(items[1]).getByText('Der Kostenvoranschlag (Version 1) wurde per E-Mail gesendet')).toBeInTheDocument()
    expect(items[1]).toHaveTextContent('10.10.2026, 10:05')
  })

  it('marks an overrun detection and a customer notice with the warning icon', () => {
    useCommunications.mockReturnValue(
      queryState({
        data: [
          entry({ id: 'overrun-1', kind: 'OVERRUN_NOTIFICATION', channel: 'PHONE', status: null }),
          entry({ id: 'overrun-1', kind: 'OVERRUN_DETECTED', channel: null, status: null }),
        ],
      }),
    )

    const { container } = render(<WorkshopCommunicationTimeline orderId="order-1" />)

    const items = screen.getAllByRole('listitem')
    expect(within(items[0]).getByText('Der Kunde wurde über den Mehrbedarf gegenüber dem Kostenvoranschlag (Version 1) informiert (Telefon)')).toBeInTheDocument()
    expect(within(items[1]).getByText('Mehrbedarf gegenüber dem Kostenvoranschlag (Version 1) festgestellt')).toBeInTheDocument()
    expect(container.querySelectorAll('.text-amber-600')).toHaveLength(2)
  })
})

describe('describeCommunication', () => {
  it.each<[WorkshopOrderCommunication, string]>([
    [entry({ status: 'QUEUED' }), 'Der Kostenvoranschlag (Version 1) wird per E-Mail versendet'],
    [entry({ status: 'SENT' }), 'Der Kostenvoranschlag (Version 1) wurde per E-Mail gesendet'],
    [entry({ status: 'FAILED' }), 'Die E-Mail mit dem Kostenvoranschlag (Version 1) konnte nicht gesendet werden'],
    [entry({ status: 'SUPPRESSED' }), 'Die E-Mail mit dem Kostenvoranschlag (Version 1) wurde nicht gesendet'],
    [entry({ status: 'SENT', version: null }), 'Der Kostenvoranschlag wurde per E-Mail gesendet'],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'LINK', decision: 'APPROVED', status: null }),
      'Der Kunde hat den Kostenvoranschlag (Version 1) über den Link freigegeben',
    ],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'LINK', decision: 'DECLINED', status: null }),
      'Der Kunde hat den Kostenvoranschlag (Version 1) über den Link abgelehnt',
    ],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: null, decision: 'DECLINED', status: null }),
      'Der Kunde hat den Kostenvoranschlag (Version 1) über den Link abgelehnt',
    ],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'ADVISOR_RECORDED', decision: 'APPROVED', status: null }),
      'Die Freigabe des Kostenvoranschlags (Version 1) wurde vom Berater erfasst',
    ],
    [
      entry({ kind: 'ESTIMATE_APPROVAL', channel: 'ADVISOR_RECORDED', decision: 'DECLINED', status: null }),
      'Die Ablehnung des Kostenvoranschlags (Version 1) wurde vom Berater erfasst',
    ],
  ])('describes %j in German', (row, expected) => {
    expect(describeCommunication(row)).toBe(expected)
  })
})

describe('describeCommunication for AUT-355 entries', () => {
  it('describes an advisor-recorded phone decision with its channel', () => {
    expect(
      describeCommunication(
        entry({
          id: 'a1',
          kind: 'ESTIMATE_APPROVAL',
          channel: 'PHONE',
          version: 2,
          occurred_at: '2026-10-12T08:00:00.000Z',
          status: null,
          decision: 'APPROVED',
        }),
      ),
    ).toBe('Die Freigabe des Kostenvoranschlags (Version 2) wurde vom Berater erfasst (Telefon)')
  })

  it('describes an advisor-recorded refusal by email with its channel', () => {
    expect(
      describeCommunication(
        entry({ kind: 'ESTIMATE_APPROVAL', channel: 'EMAIL', decision: 'DECLINED', status: null }),
      ),
    ).toBe('Die Ablehnung des Kostenvoranschlags (Version 1) wurde vom Berater erfasst (E-Mail)')
  })

  it('describes an overrun notice with its channel', () => {
    expect(
      describeCommunication(
        entry({
          id: 'n1',
          kind: 'OVERRUN_NOTIFICATION',
          channel: 'PHONE',
          version: 1,
          occurred_at: '2026-10-13T08:00:00.000Z',
          status: null,
          decision: null,
        }),
      ),
    ).toBe('Der Kunde wurde über den Mehrbedarf gegenüber dem Kostenvoranschlag (Version 1) informiert (Telefon)')
  })

  it('describes an overrun detection without a channel, naming the version it is about', () => {
    expect(
      describeCommunication(
        entry({ id: 'd1', kind: 'OVERRUN_DETECTED', channel: null, version: 2, status: null, decision: null }),
      ),
    ).toBe('Mehrbedarf gegenüber dem Kostenvoranschlag (Version 2) festgestellt')
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyWorkshopCommandProposal,
  interpretWorkshopCommand,
  proposeWorkshopCommand,
  transcribeWorkshopAudio,
  type WorkshopCommandClarification,
  type WorkshopCommandIntent,
  type WorkshopCommandProposal,
  type WorkshopCommandProposalStatus,
} from '@/api/workshop-command'
import { WorkshopCommandPanel } from './WorkshopCommandPanel'

vi.mock('@/api/workshop-command', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workshop-command')>()
  return {
    ...actual,
    interpretWorkshopCommand: vi.fn(),
    proposeWorkshopCommand: vi.fn(),
    applyWorkshopCommandProposal: vi.fn(),
    transcribeWorkshopAudio: vi.fn(),
  }
})

vi.mock('@/api/customers', () => ({
  useCustomer: () => ({ data: { first_name: 'Alex', last_name: 'Huber' } }),
}))
vi.mock('@/api/vehicles', () => ({
  useVehicle: () => ({ data: { make: 'VW', model: 'Golf', plate: 'W-SYN 515' } }),
}))
vi.mock('@/api/bays', () => ({ useBay: () => ({ data: { name: 'Bucht 1' } }) }))
vi.mock('@/api/sites', () => ({ useMySites: () => ({ data: [{ id: 'site-1', name: 'Werkstatt Nord' }] }) }))

const interpretMock = vi.mocked(interpretWorkshopCommand)
const proposeMock = vi.mocked(proposeWorkshopCommand)
const applyMock = vi.mocked(applyWorkshopCommandProposal)
const transcribeMock = vi.mocked(transcribeWorkshopAudio)

const COMMAND_ID = '11111111-1111-4111-8111-111111111111'
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222'
const SENTENCE = 'Huber Golf montag 8 Uhr großes Service'

const INTENT_BODY: WorkshopCommandProposal['intent'] = {
  contract_version: 'workshop-command/v1',
  command_id: COMMAND_ID,
  site_id: 'site-1',
  timezone: 'Europe/Vienna',
  customer_id: 'customer-1',
  vehicle_id: 'vehicle-1',
  schedule: {
    local_date: '2026-11-02',
    local_start: '08:00',
    local_end: '10:30',
    start_at: '2026-11-02T07:00:00.000Z',
    end_at: '2026-11-02T09:30:00.000Z',
    duration_minutes: 150,
    duration_source: 'preset_sum',
  },
  bay_id: 'bay-1',
  mechanic_id: null,
  loaner: {
    requested: true,
    loaner_vehicle_id: 'loaner-1',
    planned_from: null,
    planned_to: null,
  },
  position_plan: {
    version: 1,
    lines: [
      {
        preset_key: 'service.major',
        kind: 'LABOR',
        labor_operation_id: 'labor-1',
        catalog_item_id: null,
        description: 'Großes Service',
        quantity: '1.500',
        unit: 'h',
        unit_price_cents: 9000,
        net_cents: 13500,
        reservation: 'not_applicable',
      },
    ],
  },
  purpose: 'CUSTOMER_REPAIR',
  order_status: 'SCHEDULED',
  reported_issue: 'Großes Service',
}

const INTENT: WorkshopCommandIntent = { ...INTENT_BODY, status: 'ready' }

const CLARIFICATION: WorkshopCommandClarification = {
  contract_version: 'workshop-command/v1',
  status: 'clarification',
  command_id: COMMAND_ID,
  code: 'CUSTOMER_VEHICLE_AMBIGUOUS',
  prompt: 'Welcher Kunde und welches Fahrzeug sind gemeint?',
  choices: [
    { choice_id: 'customer-1', slot: 'customer_id', value: 'customer-1', label: 'Alex Huber' },
    { choice_id: 'vehicle-1', slot: 'vehicle_id', value: 'vehicle-1', label: 'VW Golf — W-SYN 515' },
  ],
  recognized: {},
  proposal: null,
}

const NO_CHOICE_CLARIFICATION: WorkshopCommandClarification = {
  ...CLARIFICATION,
  code: 'UNSUPPORTED_INTENT',
  prompt: 'Diesen Satz kann ich nicht zuordnen. Bitte präzisieren.',
  choices: [],
}

const PROPOSAL: WorkshopCommandProposal = {
  contract_version: 'workshop-command/v1',
  status: 'needs_approval',
  command_id: COMMAND_ID,
  pending_action_id: PROPOSAL_ID,
  trace_id: 'trace-1',
  action_type: 'workshop.booking_package',
  tier: 'PROPOSE',
  provisional: true,
  applied: false,
  would_change: [
    { entity: 'WorkshopOrder', op: 'create', provisional: true, id: null, status: 'SCHEDULED' },
  ],
  intent: INTENT_BODY,
}

const APPLIED = { id: PROPOSAL_ID, status: 'EXECUTED' } as WorkshopCommandProposalStatus

function typeSentence(value = SENTENCE) {
  fireEvent.change(screen.getByLabelText('Satz'), { target: { value } })
}

function renderPanel() {
  const onExit = vi.fn()
  const onOpenOrders = vi.fn()
  render(<WorkshopCommandPanel onExit={onExit} onOpenOrders={onOpenOrders} />)
  return { onExit, onOpenOrders }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkshopCommandPanel', () => {
  it('asks a clarification before any preview, then proposes and only applies on the explicit click', async () => {
    interpretMock.mockResolvedValueOnce(CLARIFICATION).mockResolvedValueOnce(INTENT)
    proposeMock.mockResolvedValueOnce(PROPOSAL)
    applyMock.mockResolvedValueOnce(APPLIED)
    const { onOpenOrders } = renderPanel()

    typeSentence()
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }))

    expect(await screen.findByText('Welcher Kunde und welches Fahrzeug sind gemeint?')).toBeInTheDocument()
    expect(screen.queryByText('Vorschau')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vorschlag übernehmen' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Alex Huber' }))

    expect(await screen.findByText('Vorschau')).toBeInTheDocument()
    expect(interpretMock).toHaveBeenLastCalledWith({
      commandId: expect.any(String),
      text: SENTENCE,
      source: 'keyboard',
      selections: [{ slot: 'customer_id', value: 'customer-1' }],
    })
    expect(screen.getByText('VW Golf — W-SYN 515')).toBeInTheDocument()
    expect(screen.getByText('Werkstatt Nord')).toBeInTheDocument()
    expect(screen.getByText('Bucht 1')).toBeInTheDocument()
    expect(screen.getByText('2026-11-02 08:00–10:30 (150 Min.)')).toBeInTheDocument()
    expect(screen.getByText('reserviert')).toBeInTheDocument()
    expect(screen.getByText('Großes Service')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Vorschlag übernehmen' }))

    expect(await screen.findByText('In der Freigabe-Queue')).toBeInTheDocument()
    expect(screen.getByText('Noch nicht angewendet')).toBeInTheDocument()
    // The proposal is queued only; nothing is written before the explicit apply.
    expect(applyMock).not.toHaveBeenCalled()
    const interpretCommandId = interpretMock.mock.calls[0][0].commandId
    expect(proposeMock).toHaveBeenCalledWith({
      commandId: interpretCommandId,
      selections: [{ slot: 'customer_id', value: 'customer-1' }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Jetzt anwenden' }))

    expect(await screen.findByText('Angewendet')).toBeInTheDocument()
    expect(applyMock).toHaveBeenCalledWith(PROPOSAL_ID)
    expect(screen.getByRole('button', { name: 'Vorschlag übernehmen' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Werkstattaufträge öffnen' }))
    expect(onOpenOrders).toHaveBeenCalledTimes(1)
  })

  it('shows a clarify question without a guessed row when the sentence is unsupported', async () => {
    interpretMock.mockResolvedValueOnce(NO_CHOICE_CLARIFICATION)
    renderPanel()

    typeSentence('irgendwas mit auto')
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }))

    expect(await screen.findByText('Diesen Satz kann ich nicht zuordnen. Bitte präzisieren.')).toBeInTheDocument()
    expect(screen.getByText('Kein Vorschlag möglich – bitte den Satz präzisieren.')).toBeInTheDocument()
    expect(screen.queryByText('Vorschau')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vorschlag übernehmen' })).not.toBeInTheDocument()
  })

  it('keeps a stale preview from turning into a pending proposal', async () => {
    interpretMock.mockResolvedValueOnce(INTENT)
    proposeMock.mockRejectedValueOnce(
      Object.assign(new Error('Failed to propose workshop command'), {
        status: 409,
        data: { code: 'PLAN_STALE', message: 'Bay is already occupied.' },
      }),
    )
    renderPanel()

    typeSentence()
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Vorschlag übernehmen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Vorschau ist veraltet (Standort oder Daten geändert). Bitte neu prüfen.',
    )
    expect(screen.queryByText('In der Freigabe-Queue')).not.toBeInTheDocument()
    expect(applyMock).not.toHaveBeenCalled()
  })

  it('keeps text commands usable when the microphone is denied', async () => {
    stubVoiceCapture({ getUserMedia: () => Promise.reject(new Error('NotAllowedError')) })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Diktieren' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kein Mikrofonzugriff. Textbefehle funktionieren weiterhin.',
    )
    expect(screen.getByLabelText('Satz')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeDisabled()

    typeSentence()
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeEnabled()
  })

  it('falls back to typing when speech-to-text is not configured', async () => {
    stubVoiceCapture({ getUserMedia: () => Promise.resolve(fakeStream()) })
    transcribeMock.mockRejectedValueOnce(
      Object.assign(new Error('Failed to transcribe workshop command'), { status: 503, data: {} }),
    )
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Diktieren' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Aufnahme beenden' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Spracherkennung ist nicht eingerichtet. Bitte den Befehl tippen.',
      ),
    )
    expect(screen.getByLabelText('Satz')).toBeEnabled()

    typeSentence()
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }))
    expect(interpretMock).toHaveBeenCalledWith({
      commandId: expect.any(String),
      text: SENTENCE,
      source: 'keyboard',
      selections: [],
    })
  })
})

function fakeStream() {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
}

/**
 * jsdom has neither MediaRecorder nor a microphone. The stub records what the
 * panel does, and `getUserMedia` decides whether access is granted.
 */
function stubVoiceCapture({ getUserMedia }: { getUserMedia: () => Promise<MediaStream> }) {
  class FakeMediaRecorder {
    static isTypeSupported = () => true
    state: 'inactive' | 'recording' = 'inactive'
    mimeType = 'audio/webm'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) })
      this.onstop?.()
    }
  }

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  })
}

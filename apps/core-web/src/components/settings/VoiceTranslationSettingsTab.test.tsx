import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import deSettings from '../../../../../locales/de/settings.json'
import { VoiceTranslationSettingsTab } from './VoiceTranslationSettingsTab'

const mockSettings = vi.hoisted(() => ({
  data: {
    targetLanguageCode: 'de',
    googleProjectId: 'test-project',
    googleLocation: 'global',
    hasGoogleCredential: false,
  },
  isLoading: false,
}))

vi.mock('@/api/voice-translation', () => ({
  useVoiceTranslationSettings: () => mockSettings,
  useUpdateVoiceTranslationSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <VoiceTranslationSettingsTab />
    </QueryClientProvider>,
  )
}

describe('VoiceTranslationSettingsTab', () => {
  beforeEach(() => {
    mockSettings.data.hasGoogleCredential = false
  })

  it('renders short status "Nicht konfiguriert" when credential is not configured', () => {
    mockSettings.data.hasGoogleCredential = false
    renderTab()

    expect(screen.getByText(deSettings.voiceTranslation.credentialNotConfigured)).toBeInTheDocument()
    expect(screen.queryByText(/Die Zugangsdaten werden verschlüsselt/)).not.toBeInTheDocument()
  })

  it('renders no status text when credential is configured (OK state)', () => {
    mockSettings.data.hasGoogleCredential = true
    renderTab()

    expect(screen.queryByText('Konfiguriert')).not.toBeInTheDocument()
    expect(screen.queryByText(deSettings.voiceTranslation.credentialNotConfigured)).not.toBeInTheDocument()
  })

  it('renders info trigger with credential guidance', () => {
    renderTab()

    expect(
      screen.getByRole('button', { name: deSettings.voiceTranslation.credentialInfoAria }),
    ).toBeInTheDocument()
  })
})

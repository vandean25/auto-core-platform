import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { registerGermanUiForTests } from '@/test/german-ui'
import { InstallAppButton } from './InstallAppButton'
import { InstallAppMenuItem } from './InstallAppMenuItem'

registerGermanUiForTests()

const usePrompt = vi.hoisted(() => vi.fn())
vi.mock('@/pwa/install-prompt', () => ({ useInstallPrompt: usePrompt }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderMenuItem() {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <InstallAppMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>,
  )
}

describe('install app entries', () => {
  it('shows an Install app menu entry with a 44px target when the browser offers it and starts the install', () => {
    const promptInstall = vi.fn()
    usePrompt.mockReturnValue({ canInstall: true, promptInstall })
    renderMenuItem()

    const item = screen.getByRole('menuitem', { name: 'App installieren' })
    expect(item).toHaveClass('min-h-11')
    fireEvent.click(item)

    expect(promptInstall).toHaveBeenCalledTimes(1)
  })

  it('shows nothing when there is no install prompt (iOS, installed app, unsupported browser)', () => {
    usePrompt.mockReturnValue({ canInstall: false, promptInstall: vi.fn() })
    renderMenuItem()
    render(<InstallAppButton />)

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'App installieren' })).not.toBeInTheDocument()
  })

  it('has a header button with a 44px target for the mechanic shell', () => {
    const promptInstall = vi.fn()
    usePrompt.mockReturnValue({ canInstall: true, promptInstall })
    render(<InstallAppButton />)

    const button = screen.getByRole('button', { name: 'App installieren' })
    expect(button).toHaveClass('min-h-11')
    fireEvent.click(button)
    expect(promptInstall).toHaveBeenCalledTimes(1)
  })
})

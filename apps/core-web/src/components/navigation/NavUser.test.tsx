import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { registerGermanUiForTests } from '@/test/german-ui'
import { AppThemeProvider } from '@/components/theme/AppThemeProvider'
import { NavUser } from './NavUser'

registerGermanUiForTests()

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ''
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderUser(onSignOut = vi.fn()) {
  render(
    <AppThemeProvider>
      <SidebarProvider>
        <NavUser userEmail="admin@example.com" onSignOut={onSignOut} />
      </SidebarProvider>
    </AppThemeProvider>,
  )
  fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
  return onSignOut
}

describe('NavUser', () => {
  it('offers German and English in the account menu', () => {
    renderUser()

    expect(screen.getByTestId('language-option-de')).toBeInTheDocument()
    expect(screen.getByTestId('language-option-en')).toBeInTheDocument()
  })

  it('signs out from the account menu', () => {
    const onSignOut = renderUser()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Abmelden' }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  // Regression: the account menu had no theme switch, and nothing set the dark class.
  it('WHEN the user picks Dunkel in the account menu THEN <html> gets the class dark and the choice is stored', () => {
    renderUser()

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dunkel' }))

    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem('acp-theme')).toBe('dark')
  })

  it('offers Hell, Dunkel and System, with System selected by default', () => {
    renderUser()

    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['Hell', 'Dunkel', 'System'])
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked()
  })
})

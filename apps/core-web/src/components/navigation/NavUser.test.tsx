import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import { MemoryRouter, type NavigateFunction } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import type { Customer } from '@/api/types'
import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import { GlobalShortcutLayer } from '@/features/shortcuts/GlobalShortcutLayer'
import {
  bindSingleKeyShortcutsUser,
  isSingleKeyShortcutsEnabled,
  setSingleKeyShortcutsEnabled,
} from '@/features/shortcuts/single-key-shortcuts-setting'
import { useRegistryRowShortcuts } from '@/features/shortcuts/use-registry-row-shortcuts'
import { changeUiLanguage } from '@/lib/i18n'
import { registerGermanUiForTests } from '@/test/german-ui'
import { AppThemeProvider } from '@/components/theme/AppThemeProvider'
import { NavUser } from './NavUser'

registerGermanUiForTests()

beforeEach(() => {
  window.localStorage.clear()
  bindSingleKeyShortcutsUser('anonymous')
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

const shortcutRowCustomer: Customer = {
  id: 'cust-1',
  type: 'PRIVATE',
  first_name: 'Anna',
  last_name: 'Alpha',
  email: 'a@example.test',
  phone: null,
  address_city: null,
  address_country: null,
}

const shortcutCustomerT = ((key: string) => key) as TFunction<'customers'>

function FocusedListHarness({ navigate }: { navigate: NavigateFunction }) {
  useRegistryRowShortcuts({
    role: 'ADMIN',
    definitions: createCustomerRowActions(shortcutCustomerT),
    runContext: { navigate, onDelete: vi.fn(), t: shortcutCustomerT },
    records: [shortcutRowCustomer],
  })

  return (
    <table>
      <tbody>
        <tr data-table-row="true" data-row-id={shortcutRowCustomer.id} tabIndex={0}>
          <td>{shortcutRowCustomer.first_name}</td>
        </tr>
      </tbody>
    </table>
  )
}

describe('NavUser keyboard shortcut controls', () => {
  // Regression (AUT-951): Radix DropdownMenuCheckboxItem must expose its accessible name in the checked state as well as unchecked.
  it('WHEN the user menu is opened with single-key shortcuts checked THEN the menuitemcheckbox accessible name is "Einzeltasten-Kürzel" (DE)', () => {
    renderUser()

    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Einzeltasten-Kürzel' })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleName('Einzeltasten-Kürzel')
    expect(toggle).toHaveTextContent('Einzeltasten-Kürzel')
  })

  it('WHEN the setting is unchecked THEN the same control still has that accessible name', () => {
    setSingleKeyShortcutsEnabled(false)
    renderUser()

    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Einzeltasten-Kürzel' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleName('Einzeltasten-Kürzel')
    expect(toggle).toHaveTextContent('Einzeltasten-Kürzel')
  })

  it('WHEN the UI language is EN THEN the checked and unchecked states use the English accessible name', async () => {
    await changeUiLanguage('en')
    renderUser()

    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Single-key shortcuts' })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleName('Single-key shortcuts')

    fireEvent.click(toggle)

    const unchecked = screen.getByRole('menuitemcheckbox', { name: 'Single-key shortcuts' })
    expect(unchecked).not.toBeChecked()
    expect(unchecked).toHaveAccessibleName('Single-key shortcuts')
  })

  // Regression: global single-key shortcuts had no turn-off control (WCAG 2.1.4) and `?` was the only way to the help sheet.
  it('WHEN the setting is toggled from the named control THEN shortcut behaviour still matches AUT-877', () => {
    const navigate = vi.fn() as NavigateFunction
    render(
      <AppThemeProvider>
        <SidebarProvider>
          <MemoryRouter>
            <GlobalShortcutLayer />
            <NavUser userEmail="admin@example.com" onSignOut={vi.fn()} />
            <FocusedListHarness navigate={navigate} />
          </MemoryRouter>
        </SidebarProvider>
      </AppThemeProvider>,
    )

    const row = document.querySelector('tr[data-row-id="cust-1"]') as HTMLElement
    row.focus()
    fireEvent.keyDown(row, { key: 'o', code: 'KeyO' })
    expect(navigate).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Einzeltasten-Kürzel' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)

    expect(screen.getByRole('menuitemcheckbox', { name: 'Einzeltasten-Kürzel' })).not.toBeChecked()
    expect(isSingleKeyShortcutsEnabled()).toBe(false)
    expect(window.localStorage.getItem('acp:single-key-shortcuts:anonymous')).toBe('off')

    fireEvent.keyDown(toggle, { key: 'Escape' })
    row.focus()
    fireEvent.keyDown(row, { key: 'o', code: 'KeyO' })
    expect(navigate).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Einzeltasten-Kürzel' }))
    expect(isSingleKeyShortcutsEnabled()).toBe(true)

    fireEvent.keyDown(screen.getByRole('menuitemcheckbox', { name: 'Einzeltasten-Kürzel' }), { key: 'Escape' })
    row.focus()
    fireEvent.keyDown(row, { key: 'o', code: 'KeyO' })
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it('opens the shortcut sheet from a normal menu item', async () => {
    render(
      <AppThemeProvider>
        <SidebarProvider>
          <MemoryRouter>
            <GlobalShortcutLayer />
            <NavUser userEmail="admin@example.com" onSignOut={vi.fn()} />
          </MemoryRouter>
        </SidebarProvider>
      </AppThemeProvider>,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Tastenkürzel anzeigen' }))

    expect(await screen.findByRole('dialog', { name: 'Tastenkürzel' })).toBeInTheDocument()
  })
})

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

  // Regression (AUT-1029): the selected radio indicator must not leave System (or Hell/Dunkel) without a name.
  it('WHEN the theme control is opened in DE THEN Hell, Dunkel and System expose matching accessible names whether selected or not', () => {
    renderUser()

    expectThemeOptionName('light', 'Hell')
    expectThemeOptionName('dark', 'Dunkel')
    expectThemeOptionName('system', 'System')
    expect(screen.getByTestId('theme-option-system')).toBeChecked()

    fireEvent.click(screen.getByTestId('theme-option-dark'))
    fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })

    expect(screen.getByTestId('theme-option-dark')).toBeChecked()
    expect(screen.getByTestId('theme-option-system')).not.toBeChecked()
    expectThemeOptionName('light', 'Hell')
    expectThemeOptionName('dark', 'Dunkel')
    expectThemeOptionName('system', 'System')
  })

  it('WHEN the theme control is opened in EN THEN Light, Dark and System expose matching accessible names whether selected or not', async () => {
    await changeUiLanguage('en')
    renderUser()

    expect(screen.getByTestId('theme-option-system')).toBeChecked()
    expectThemeOptionName('light', 'Light')
    expectThemeOptionName('dark', 'Dark')
    expectThemeOptionName('system', 'System')

    fireEvent.click(screen.getByTestId('theme-option-light'))
    fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })

    expect(screen.getByTestId('theme-option-light')).toBeChecked()
    expect(screen.getByTestId('theme-option-system')).not.toBeChecked()
    expectThemeOptionName('light', 'Light')
    expectThemeOptionName('dark', 'Dark')
    expectThemeOptionName('system', 'System')
  })

  it('WHEN the named System option is activated THEN the theme follows OS preference', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    )
    renderUser()

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hell' }))
    expect(document.documentElement).not.toHaveClass('dark')

    fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'System' }))

    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem('acp-theme')).toBe('system')

    fireEvent.keyDown(screen.getByRole('button', { name: 'admin@example.com' }), { key: 'Enter' })
    expect(screen.getByTestId('theme-option-system')).toBeChecked()
    expect(screen.getByTestId('theme-option-light')).not.toBeChecked()
    expect(screen.getByTestId('theme-option-dark')).not.toBeChecked()
  })
})

/** The option's accessible name is the visible label, including when the radio dot is shown. */
function expectThemeOptionName(value: 'light' | 'dark' | 'system', label: string) {
  const option = screen.getByTestId(`theme-option-${value}`)
  const labelId = option.getAttribute('aria-labelledby')
  expect(labelId).toEqual(expect.stringMatching(/\S/))
  const labelNode = document.getElementById(labelId!)
  expect(labelNode?.textContent).toBe(label)
  expect(labelNode).not.toHaveAttribute('aria-hidden', 'true')
  expect(option).toContainElement(labelNode)
  expect(option).toHaveAccessibleName(label)
  expect(option.querySelector(':scope > span')).toHaveAttribute('aria-hidden', 'true')
}

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

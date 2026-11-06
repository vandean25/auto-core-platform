import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  type NavigateFunction,
} from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'
import { DataTable } from '@/components/data-table/DataTable'
import type { Customer } from '@/api/types'
import { G_SEQUENCE_TIMEOUT_MS } from './shortcut-constants'
import {
  getFocusedDataTableRowId,
  isFocusOnDataTableRow,
  isShortcutLayerSuspended,
} from './shortcut-guard'
import { GlobalShortcutLayer } from './GlobalShortcutLayer'
import {
  bindSingleKeyShortcutsUser,
  setSingleKeyShortcutsEnabled,
} from './single-key-shortcuts-setting'
import { useRegistryRowShortcuts } from './use-registry-row-shortcuts'

beforeEach(() => {
  window.localStorage.clear()
  bindSingleKeyShortcutsUser('test-user')
})

const customerA: Customer = {
  id: 'cust-a',
  type: 'PRIVATE',
  first_name: 'Anna',
  last_name: 'Alpha',
  email: 'a@example.test',
  phone: null,
  address_city: null,
  address_country: null,
}

const customerB: Customer = {
  id: 'cust-b',
  type: 'PRIVATE',
  first_name: 'Ben',
  last_name: 'Beta',
  email: 'b@example.test',
  phone: null,
  address_city: null,
  address_country: null,
}

function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

const customerT = ((key: string) => key) as TFunction<'customers'>

function CustomerRowShortcutHarness({
  records,
  role = 'ADMIN',
  navigate = vi.fn() as NavigateFunction,
  definitions = createCustomerRowActions(customerT),
}: {
  records: Customer[]
  role?: string
  navigate?: NavigateFunction
  definitions?: ReturnType<typeof createCustomerRowActions>
}) {
  const runContext = { navigate, onDelete: vi.fn(), t: customerT }

  useRegistryRowShortcuts({
    role,
    definitions,
    runContext,
    records,
  })

  return (
    <table>
      <tbody>
        {records.map((record) => (
          <tr
            key={record.id}
            data-table-row="true"
            data-row-id={record.id}
            tabIndex={0}
          >
            <td>{record.id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function focusRow(rowId: string) {
  const row = document.querySelector(`tr[data-row-id="${rowId}"]`)
  expect(row).toBeTruthy()
  ;(row as HTMLElement).focus()
}

function keyCodeFor(key: string): string {
  if (key.length === 1 && key >= 'a' && key <= 'z') {
    return `Key${key.toUpperCase()}`
  }
  if (key.length === 1 && key >= 'A' && key <= 'Z') {
    return `Key${key}`
  }
  if (key === '?') {
    return 'Slash'
  }
  return key
}

function pressKey(
  target: Document | Element | Window,
  key: string,
  init: KeyboardEventInit = {},
) {
  fireEvent.keyDown(target, {
    key,
    code: init.code ?? keyCodeFor(key),
    bubbles: true,
    ...init,
  })
}

describe('shortcut guard', () => {
  it('detects focused data table rows', () => {
    render(
      <table>
        <tbody>
          <tr data-table-row="true" data-row-id="row-1" tabIndex={0}>
            <td>Row</td>
          </tr>
        </tbody>
      </table>,
    )
    focusRow('row-1')
    expect(isFocusOnDataTableRow()).toBe(true)
    expect(getFocusedDataTableRowId()).toBe('row-1')
  })

  it('treats open dialogs as suspended', () => {
    render(<div role="dialog" />)
    expect(isShortcutLayerSuspended()).toBe(true)
  })
})

describe('useRegistryRowShortcuts', () => {
  it('runs the open action for the focused row', () => {
    const navigate = vi.fn() as NavigateFunction
    const Harness = () => {
      const definitions = createCustomerRowActions(customerT)
      useRegistryRowShortcuts({
        role: 'ADMIN',
        definitions,
        runContext: { navigate, onDelete: vi.fn(), t: customerT },
        records: [customerA, customerB],
      })
      return (
        <table>
          <tbody>
            {[customerA, customerB].map((record) => (
              <tr
                key={record.id}
                data-table-row="true"
                data-row-id={record.id}
                tabIndex={0}
              >
                <td>{record.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    render(<Harness />)
    focusRow('cust-b')
    pressKey(document, 'o')
    expect(navigate).toHaveBeenCalledWith('/customers/cust-b')
  })

  it('does nothing without a focused row', () => {
    const navigate = vi.fn()
    render(<CustomerRowShortcutHarness records={[customerA]} navigate={navigate} />)
    pressKey(document.body, 'o')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores shortcuts in inputs and with modifiers', () => {
    const navigate = vi.fn()
    render(
      <div>
        <CustomerRowShortcutHarness records={[customerA]} navigate={navigate} />
        <input data-testid="field" />
      </div>,
    )
    focusRow('cust-a')
    const input = screen.getByTestId('field')
    input.focus()
    pressKey(input, 'o')
    expect(navigate).not.toHaveBeenCalled()

    focusRow('cust-a')
    pressKey(document, 'o', { ctrlKey: true })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not run actions filtered out by role', () => {
    const navigate = vi.fn() as NavigateFunction
    const definitions = createCustomerRowActions(customerT).map((definition) =>
      definition.id === ENTITY_ACTION_IDS.customerOpen
        ? { ...definition, isAllowedForRole: () => false }
        : definition,
    )
    render(
      <CustomerRowShortcutHarness
        records={[customerA]}
        navigate={navigate}
        definitions={definitions}
      />,
    )
    focusRow('cust-a')
    pressKey(document, 'o')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores repeated O so navigate runs only once', () => {
    const navigate = vi.fn() as NavigateFunction
    render(<CustomerRowShortcutHarness records={[customerA]} navigate={navigate} />)
    focusRow('cust-a')
    pressKey(document, 'o')
    pressKey(document, 'o', { repeat: true })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/customers/cust-a')
  })
})

describe('GlobalShortcutLayer', () => {
  it('navigates with G W', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <GlobalShortcutLayer />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    pressKey(document, 'g')
    pressKey(document, 'w')
    expect(screen.getByTestId('location')).toHaveTextContent('/workshop/orders')
  })

  it('times out stale G-sequences', () => {
    vi.useFakeTimers()
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <GlobalShortcutLayer />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    pressKey(document, 'g')
    vi.advanceTimersByTime(G_SEQUENCE_TIMEOUT_MS + 1)
    pressKey(document, 'w')
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')
    vi.useRealTimers()
  })

  it('opens the help overlay on ? and not inside inputs', async () => {
    render(
      <MemoryRouter>
        <GlobalShortcutLayer />
        <input data-testid="field" />
      </MemoryRouter>,
    )

    pressKey(document, '?', { shiftKey: true })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(deCommon.shortcuts.title)
    expect(dialog).toHaveTextContent(deCommon.shortcuts.entries.goWorkshopOrders)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    const input = screen.getByTestId('field')
    input.focus()
    pressKey(input, '?', { shiftKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores repeated G then navigates on W', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <GlobalShortcutLayer />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    pressKey(document, 'g')
    pressKey(document, 'g', { repeat: true })
    pressKey(document, 'w')
    expect(screen.getByTestId('location')).toHaveTextContent('/workshop/orders')
  })

  it('does not navigate when G is pressed with Ctrl', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <GlobalShortcutLayer />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    pressKey(document, 'g', { ctrlKey: true })
    pressKey(document, 'w')
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')
  })

  it('replaces an armed chord when G is pressed again before timeout', () => {
    vi.useFakeTimers()
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <GlobalShortcutLayer />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    pressKey(document, 'g')
    vi.advanceTimersByTime(200)
    pressKey(document, 'w')
    expect(screen.getByTestId('location')).toHaveTextContent('/workshop/orders')

    vi.advanceTimersByTime(700)
    pressKey(document, 'g')
    vi.advanceTimersByTime(200)
    pressKey(document, 'c')
    expect(screen.getByTestId('location')).toHaveTextContent('/customers')
    vi.useRealTimers()
  })

  it('suspends G-sequences while a dialog is open', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <div role="dialog" data-testid="blocking-dialog" />
                <GlobalShortcutLayer />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
    expect(isShortcutLayerSuspended()).toBe(true)

    pressKey(document, 'g')
    pressKey(document, 'c')
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')
  })
})

describe('GlobalShortcutLayer navigation sequences', () => {
  it('navigates to customers and vehicles', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <GlobalShortcutLayer />
                <LocationDisplay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    pressKey(document, 'g')
    pressKey(document, 'c')
    expect(screen.getByTestId('location')).toHaveTextContent('/customers')

    pressKey(document, 'g')
    pressKey(document, 'v')
    expect(screen.getByTestId('location')).toHaveTextContent('/vehicles')
  })
})

const customerC: Customer = { ...customerB, id: 'cust-c', first_name: 'Cleo', last_name: 'Gamma' }

function CustomerListHarness({
  records = [customerA, customerB, customerC],
  actorRole = 'ADMIN',
  navigate = vi.fn() as NavigateFunction,
}: {
  records?: Customer[]
  actorRole?: string
  navigate?: NavigateFunction
}) {
  const definitions = useMemo(() => createCustomerRowActions(customerT), [])
  const runContext = useMemo(
    () => ({ navigate, onDelete: vi.fn(), t: customerT }),
    [navigate],
  )
  const tableBehaviour = useMemo(() => ({ onRowClick: vi.fn() }), [])
  useRegistryRowShortcuts({ role: actorRole, definitions, runContext, records })
  const rowBehaviour = useRegistryRowBehaviour({ role: actorRole, definitions, runContext, tableBehaviour })

  return (
    <DataTable
      columns={[{ accessorKey: 'id', header: 'ID' }]}
      data={records}
      columnFilters={[]}
      setColumnFilters={vi.fn()}
      sorting={[]}
      setSorting={vi.fn()}
      pagination={{ pageIndex: 0, pageSize: 10 }}
      setPagination={vi.fn()}
      rowBehaviour={rowBehaviour}
      bulkActions={(rows) => <output data-testid="selected">{rows.map((r) => r.id).join(',')}</output>}
    />
  )
}

function renderShell(children: React.ReactNode, initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <GlobalShortcutLayer />
      <LocationDisplay />
      {children}
    </MemoryRouter>,
  )
}

function rowEl(rowId: string): HTMLElement {
  return document.querySelector(`tr[data-row-id="${rowId}"]`) as HTMLElement
}

describe('single-key shortcuts (AUT-877, ADR-0036 R5)', () => {
  // Regression: j on a fresh list advanced to row 2 (or did nothing) instead of entering at row 1.
  it('SCENARIO 1: j on a fresh list focuses row 1 (not row 2) and never steals focus from a control', () => {
    renderShell(
      <>
        <button type="button">Other control</button>
        <CustomerListHarness />
      </>,
    )

    screen.getByRole('button', { name: 'Other control' }).focus()
    pressKey(document, 'j')
    expect(screen.getByRole('button', { name: 'Other control' })).toHaveFocus()

    ;(document.activeElement as HTMLElement).blur()
    pressKey(document, 'j')
    expect(rowEl('cust-a')).toHaveFocus()

    pressKey(document, 'j')
    expect(rowEl('cust-b')).toHaveFocus()
    pressKey(document, 'k')
    expect(rowEl('cust-a')).toHaveFocus()
  })

  // Regression: row actions ran without the normal role predicate, or more than once per press.
  it('SCENARIO 2: a registry shortcutKey on a focused row runs the action once, and only when the role allows it', () => {
    const navigate = vi.fn() as NavigateFunction
    const { unmount } = renderShell(<CustomerListHarness navigate={navigate} />)

    rowEl('cust-b').focus()
    pressKey(document, 'o')
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/customers/cust-b')
    unmount()

    const deniedNavigate = vi.fn() as NavigateFunction
    renderShell(<CustomerListHarness navigate={deniedNavigate} actorRole="" />)
    rowEl('cust-b').focus()
    pressKey(document, 'o')
    expect(deniedNavigate).not.toHaveBeenCalled()
  })

  // Regression: character keys fired while typing or composing (IME), hijacking the user's text.
  it('SCENARIO 3: j/k/x and action keys do nothing while typing in an input or composing with an IME', () => {
    const navigate = vi.fn() as NavigateFunction
    renderShell(
      <>
        <input data-testid="field" />
        <CustomerListHarness navigate={navigate} />
      </>,
    )

    // Positive control: the same keys do work on a focused row.
    rowEl('cust-a').focus()
    pressKey(document, 'j')
    expect(rowEl('cust-b')).toHaveFocus()

    const field = screen.getByTestId('field')
    field.focus()
    for (const key of ['j', 'k', 'x', 'o']) pressKey(field, key)
    expect(field).toHaveFocus()

    // IME: a row is focused, but the keystroke belongs to the composition (keyCode 229 / isComposing).
    rowEl('cust-b').focus()
    for (const key of ['j', 'k', 'x', 'o']) pressKey(document, key, { isComposing: true, keyCode: 229 })

    expect(rowEl('cust-b')).toHaveFocus()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('selected')).not.toBeInTheDocument()
  })

  // Regression: global single keys (j, ?, g-sequences) could not be turned off (WCAG 2.1.4).
  it('SCENARIO 4: with the setting off, j, ? and g-sequences do nothing and a pending g is cleared', () => {
    renderShell(<CustomerListHarness />)

    pressKey(document, 'g')
    act(() => setSingleKeyShortcutsEnabled(false))

    pressKey(document, 'j')
    pressKey(document, '?', { shiftKey: true })
    pressKey(document, 'w')
    expect(document.body).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')

    // Re-enabling must not resurrect the sequence that was armed before the switch-off.
    act(() => setSingleKeyShortcutsEnabled(true))
    pressKey(document, 'w')
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard')

    pressKey(document, 'g')
    pressKey(document, 'w')
    expect(screen.getByTestId('location')).toHaveTextContent('/workshop/orders')
  })

  // Regression: holding a key repeated the action (and toggled selection back off).
  it('SCENARIO 5: a held key fires no mutation more than once', () => {
    const navigate = vi.fn() as NavigateFunction
    renderShell(<CustomerListHarness navigate={navigate} />)

    pressKey(document, 'j', { repeat: true })
    expect(document.body).toHaveFocus()

    rowEl('cust-a').focus()
    pressKey(document, 'x')
    for (let i = 0; i < 3; i += 1) pressKey(document, 'x', { repeat: true })
    expect(screen.getByTestId('selected')).toHaveTextContent('cust-a')

    pressKey(document, 'o')
    for (let i = 0; i < 3; i += 1) pressKey(document, 'o', { repeat: true })
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  // Regression: row keys reached the list behind an open dialog.
  it('SCENARIO 6: with a dialog open, row keys do not reach the list behind it', () => {
    const navigate = vi.fn() as NavigateFunction
    renderShell(
      <>
        <CustomerListHarness navigate={navigate} />
        <div role="dialog" aria-label="Open dialog" />
      </>,
    )

    rowEl('cust-a').focus()
    for (const key of ['j', 'x', 'o']) pressKey(document, key)

    expect(within(document.body).getByRole('dialog')).toBeInTheDocument()
    expect(rowEl('cust-a')).toHaveFocus()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('selected')).not.toBeInTheDocument()
  })

  // Regression: the help sheet showed a static key list instead of the keys the current page really honours.
  it('help sheet lists the effective keys of the mounted list and none while single-key shortcuts are off', async () => {
    renderShell(<CustomerListHarness />)

    pressKey(document, '?', { shiftKey: true })
    const dialog = await screen.findByRole('dialog')
    const lists = within(dialog).getByRole('heading', { name: deCommon.shortcuts.sections.lists }).parentElement as HTMLElement
    expect(within(lists).getAllByText(/^[A-Z]$/).map((key) => key.textContent)).toEqual(['J', 'K', 'X', 'O'])

    act(() => setSingleKeyShortcutsEnabled(false))
    expect(within(dialog).queryByRole('heading', { name: deCommon.shortcuts.sections.lists })).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent('Einzeltasten-Kürzel sind ausgeschaltet')
  })
})

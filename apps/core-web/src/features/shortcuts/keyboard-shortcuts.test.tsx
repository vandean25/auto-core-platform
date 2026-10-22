import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TFunction } from 'i18next'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  type NavigateFunction,
} from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import type { Customer } from '@/api/types'
import { G_SEQUENCE_TIMEOUT_MS } from './shortcut-constants'
import {
  getFocusedDataTableRowId,
  isFocusOnDataTableRow,
  isShortcutLayerSuspended,
} from './shortcut-guard'
import { GlobalShortcutLayer } from './GlobalShortcutLayer'
import { useRegistryRowShortcuts } from './use-registry-row-shortcuts'

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
      definition.id === 'open'
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
    expect(screen.getAllByText('O').length).toBeGreaterThan(0)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    const input = screen.getByTestId('field')
    input.focus()
    pressKey(input, '?', { shiftKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

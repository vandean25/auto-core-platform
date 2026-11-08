import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { InlineEdit } from './InlineEdit'
import { InlineEditCommandPicker } from './InlineEditCommandPicker'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'

describe('InlineEdit', () => {
  afterEach(() => {
    cleanup()
  })

  it('invites to edit an empty value in German, and a caller text wins', () => {
    const { rerender } = render(<InlineEdit value='' onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Zum Bearbeiten klicken' })).toBeInTheDocument()

    rerender(<InlineEdit value='' emptyText='Notiz hinzufügen' onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Notiz hinzufügen' })).toBeInTheDocument()
    expect(screen.queryByText('Click to edit')).not.toBeInTheDocument()
  })

  it('links the validation error to the input it describes', async () => {
    const onSave = vi.fn()
    render(
      <InlineEdit
        value="Brake fluid"
        ariaLabel="Note"
        schema={z.string().min(3, 'Note must have at least 3 characters')}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Brake fluid' }))
    const input = screen.getByRole('textbox', { name: 'Note' })
    expectFieldValid(input)

    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Note must have at least 3 characters')
    expectFieldErrorLinked(input, 'Note must have at least 3 characters')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('links the validation error of a textarea to the textarea', async () => {
    render(
      <InlineEdit
        value="Check pads"
        mode="textarea"
        ariaLabel="Note"
        schema={z.string().min(5, 'Note must have at least 5 characters')}
        onSave={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Check pads' }))
    const textarea = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(textarea, { target: { value: 'ok' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Note must have at least 5 characters')
    expectFieldErrorLinked(textarea, 'Note must have at least 5 characters')
  })

  it('caps the text editor at the length the caller passes', () => {
    render(<InlineEdit value="Hauptstrasse 1" ariaLabel="Straße" maxLength={200} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hauptstrasse 1' }))

    expect(screen.getByRole('textbox', { name: 'Straße' })).toHaveAttribute('maxLength', '200')
  })

  it('caps the textarea editor at the length the caller passes', () => {
    render(
      <InlineEdit
        value="Hauptstrasse 1"
        mode="textarea"
        ariaLabel="Straße"
        maxLength={200}
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hauptstrasse 1' }))

    expect(screen.getByRole('textbox', { name: 'Straße' })).toHaveAttribute('maxLength', '200')
  })
})

const mechanics = [
  { value: 'mech-anna', label: 'Anna Berger' },
  { value: 'mech-bernd', label: 'Bernd Hofer' },
  ...Array.from({ length: 40 }, (_, index) => ({
    value: `mech-${index}`,
    label: `Mechaniker ${index}`,
  })),
]

const statuses = [
  { value: 'IN_PROGRESS', label: 'In Bearbeitung' },
  { value: 'WAITING_PARTS', label: 'Wartet auf Teile' },
]

describe('InlineEdit command picker', () => {
  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  })

  it('WHEN the user opens the mechanic picker and types part of a name THEN only matching mechanics are listed', () => {
    render(
      <InlineEditCommandPicker
        value={null}
        options={mechanics}
        onSave={vi.fn()}
        ariaLabel="Zugewiesener Mechaniker"
        emptyText="Nicht zugewiesen"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zugewiesener Mechaniker' }))
    fireEvent.change(screen.getByPlaceholderText('Suchen'), { target: { value: 'ann' } })

    expect(screen.getByRole('option', { name: 'Anna Berger' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Bernd Hofer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Mechaniker 0' })).not.toBeInTheDocument()
  })

  it('WHEN the user picks a status with Enter THEN the value is saved and the picker closes', () => {
    const onSave = vi.fn((): Promise<void> => new Promise(() => undefined))
    render(
      <InlineEditCommandPicker
        value="WAITING_PARTS"
        options={statuses}
        saveMode="optimistic"
        onSave={onSave}
        ariaLabel="Aufgabenstatus"
        emptyText="Nicht gesetzt"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Aufgabenstatus' }))
    const search = screen.getByPlaceholderText('Suchen')
    fireEvent.change(search, { target: { value: 'bearb' } })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(onSave).toHaveBeenCalledWith('IN_PROGRESS')
    expect(screen.queryByRole('option', { name: 'In Bearbeitung' })).not.toBeInTheDocument()
  })

  it('WHEN the user presses Esc THEN the picker closes without saving', () => {
    const onSave = vi.fn()
    render(
      <InlineEditCommandPicker
        value="IN_PROGRESS"
        options={statuses}
        onSave={onSave}
        ariaLabel="Aufgabenstatus"
        emptyText="Nicht gesetzt"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Aufgabenstatus' }))
    fireEvent.keyDown(screen.getByPlaceholderText('Suchen'), { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Suchen')).not.toBeInTheDocument()
  })

  it('WHEN the viewport is 375px THEN the picker opens as a bottom sheet with ≥44px rows', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    render(
      <InlineEditCommandPicker
        value="mech-anna"
        options={mechanics.slice(0, 2)}
        onSave={vi.fn()}
        ariaLabel="Zugewiesener Mechaniker"
        emptyText="Nicht zugewiesen"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zugewiesener Mechaniker' }))

    const sheet = screen.getByRole('dialog')
    expect(sheet).toHaveAttribute('data-side', 'bottom')
    const row = screen.getByRole('option', { name: 'Anna Berger' })
    expect(Number.parseFloat(row.style.minHeight)).toBeGreaterThanOrEqual(44)
  })

  it('WHEN the role may not change the field THEN the picker is not offered', () => {
    render(
      <InlineEditCommandPicker
        value="IN_PROGRESS"
        options={statuses}
        readOnly
        onSave={vi.fn()}
        ariaLabel="Aufgabenstatus"
        emptyText="Nicht gesetzt"
      />,
    )

    expect(screen.queryByRole('button', { name: 'Aufgabenstatus' })).not.toBeInTheDocument()
    expect(screen.getByText('In Bearbeitung')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Suchen')).not.toBeInTheDocument()
  })
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { TyreMeasurementForm } from './TyreMeasurementForm'

function fillTreads() {
  for (const position of ['Vorne links', 'Vorne rechts', 'Hinten links', 'Hinten rechts']) {
    for (const point of ['Innen', 'Mitte', 'Außen']) {
      fireEvent.change(screen.getByLabelText(`${position} ${point}`), { target: { value: '5.25' } })
    }
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TyreMeasurementForm', () => {
  it('reports edits and pending submission, clearing dirty state only after a successful save', async () => {
    let resolveSave!: () => void
    const onSave = () => new Promise<void>((resolve) => { resolveSave = resolve })
    const onStateChange = vi.fn()
    render(<TyreMeasurementForm onSave={onSave} onStateChange={onStateChange} />)
    expect(onStateChange).toHaveBeenLastCalledWith({ isDirty: false, isSubmitting: false })
    fillTreads()
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ isDirty: true, isSubmitting: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ isDirty: true, isSubmitting: true }))
    resolveSave()
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ isDirty: false, isSubmitting: false }))
  })

  it('retains dirty state after a failed save', async () => {
    const onStateChange = vi.fn()
    render(<TyreMeasurementForm onSave={vi.fn().mockRejectedValue(new Error('offline'))} onStateChange={onStateChange} />)
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await screen.findByRole('alert')
    expect(onStateChange).toHaveBeenLastCalledWith({ isDirty: true, isSubmitting: false })
  })

  it('discards edits only after confirmation without posting a measurement', async () => {
    const onSave = vi.fn()
    const onStateChange = vi.fn()
    render(<TyreMeasurementForm onSave={onSave} onStateChange={onStateChange} />)
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung verwerfen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.getByLabelText('Vorne links Innen')).toHaveValue(5.25)
    fireEvent.click(screen.getByRole('button', { name: 'Messung verwerfen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ isDirty: false, isSubmitting: false }))
    expect(screen.getByLabelText('Vorne links Innen')).toHaveValue(null)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('allows confirmed discard while a queued photo prevents saving', async () => {
    const onStateChange = vi.fn()
    render(<TyreMeasurementForm onSave={vi.fn()} onStateChange={onStateChange}
      onPhoto={vi.fn().mockResolvedValue('pending-photo')} pendingMediaIds={['pending-photo']} />)
    fireEvent.change(screen.getByLabelText('Vorne links Reifenfoto aufnehmen'), { target: { files: [new File(['photo'], 'tyre.png', { type: 'image/png' })] } })
    await screen.findByRole('status')
    expect(screen.getByRole('button', { name: 'Messung speichern' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Messung verwerfen' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Messung verwerfen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ isDirty: false, isSubmitting: false }))
  })

  it('accepts full DOT identifiers up to the DTO limit', () => {
    render(<TyreMeasurementForm onSave={vi.fn()} />)
    expect(screen.getByLabelText('Vorne links DOT')).toHaveAttribute('maxlength', '80')
  })

  it('never writes NaN to native tread inputs on mount or when adding a spare', () => {
    const valueSetter = vi.spyOn(HTMLInputElement.prototype, 'value', 'set')
    const consoleWarn = vi.spyOn(console, 'warn')
    const consoleError = vi.spyOn(console, 'error')
    render(<TyreMeasurementForm onSave={vi.fn()} />)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(12)
    fireEvent.click(screen.getByLabelText('Reserverad erfassen'))
    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toHaveValue(null)
      expect(input).toBeRequired()
    }
    expect(valueSetter).not.toHaveBeenCalledWith(NaN)
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it.each(['', '-0.01', '20.01'])('rejects an empty or out-of-range tread reading %s', async (value) => {
    const onSave = vi.fn()
    const { container } = render(<TyreMeasurementForm onSave={onSave} />)
    fillTreads()
    fireEvent.change(screen.getByLabelText('Vorne links Innen'), { target: { value } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(screen.getByLabelText('Vorne links Innen')).toHaveAttribute('aria-invalid', 'true'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('validates tread depth for 25 and -1 with localized inline messages in German (DE)', async () => {
    const onSave = vi.fn()
    const { container } = render(<TyreMeasurementForm onSave={onSave} />)
    expect(container.querySelector('form')).toHaveAttribute('noValidate')
    fillTreads()
    fireEvent.change(screen.getByLabelText('Vorne links Innen'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Vorne links Mitte'), { target: { value: '-1' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => {
      expect(screen.getByText('Profiltiefe max. 20 mm')).toBeVisible()
      expect(screen.getByText('Profiltiefe min. 0 mm')).toBeVisible()
    })
    expect(screen.getByLabelText('Vorne links Innen')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Vorne links Mitte')).toHaveAttribute('aria-invalid', 'true')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('validates tread depth for 25 and -1 with localized inline messages in English (EN)', async () => {
    await changeUiLanguage('en')
    const onSave = vi.fn()
    const { container } = render(<TyreMeasurementForm onSave={onSave} />)
    expect(container.querySelector('form')).toHaveAttribute('noValidate')
    for (const position of ['Front left', 'Front right', 'Rear left', 'Rear right']) {
      for (const point of ['Inner', 'Middle', 'Outer']) {
        fireEvent.change(screen.getByLabelText(`${position} ${point}`), { target: { value: '5.25' } })
      }
    }
    fireEvent.change(screen.getByLabelText('Front left Inner'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Front left Middle'), { target: { value: '-1' } })
    fireEvent.submit(container.querySelector('form')!)

    await waitFor(() => {
      expect(screen.getByText('Tread depth max. 20 mm')).toBeVisible()
      expect(screen.getByText('Tread depth min. 0 mm')).toBeVisible()
    })
    expect(screen.getByLabelText('Front left Inner')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Front left Middle')).toHaveAttribute('aria-invalid', 'true')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('starts with empty tread fields, uses a decimal keypad and saves all three points per wheel', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<TyreMeasurementForm onSave={onSave} />)
    const input = screen.getByLabelText('Vorne links Innen')
    expect(input).toHaveValue(null)
    expect(input).toHaveAttribute('inputmode', 'decimal')
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ wheels: expect.arrayContaining([
      expect.objectContaining({ position: 'FL', treadInnerMm: 5.25, treadMiddleMm: 5.25, treadOuterMm: 5.25 }),
    ]) })))
  })

  it('copies brand model and size without overwriting other wheels tread measurements', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<TyreMeasurementForm onSave={onSave} />)
    fillTreads()
    fireEvent.change(screen.getByLabelText('Vorne links Marke'), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText('Vorne links Modell'), { target: { value: 'Road' } })
    fireEvent.change(screen.getByLabelText('Vorne links Größe'), { target: { value: '205/55 R16' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Marke, Modell und Größe auf alle Räder kopieren' })[0])
    expect(screen.getByLabelText('Hinten rechts Marke')).toHaveValue('Example')
    expect(screen.getByLabelText('Hinten rechts Innen')).toHaveValue(5.25)
  })

  it('shows the server DOT error on the named wheel without showing raw API text', async () => {
    const onSave = vi.fn().mockRejectedValue({ status: 400, data: {
      code: 'TYRE_DOT_INVALID_WEEK', params: { position: 'FR' }, message: 'Bad Request Exception',
    } })
    render(<TyreMeasurementForm onSave={onSave} />)
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(screen.getByLabelText('Vorne rechts DOT')).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText(/Herstellungswoche.*ungültig/)).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('Vorne rechts DOT')).toHaveFocus())
    expect(screen.queryByText('Bad Request Exception')).not.toBeInTheDocument()
  })

  it('maps nested validator paths to the corresponding field', async () => {
    render(<TyreMeasurementForm onSave={vi.fn().mockRejectedValue({ status: 400, data: {
      code: 'HTTP_400', message: ['wheels.2.treadOuterMm must not be greater than 20'],
    } })} />)
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(screen.getByLabelText('Hinten links Außen')).toHaveAttribute('aria-invalid', 'true'))
  })

  it('shows accessible field errors for every dropdown without marking other wheels invalid', async () => {
    render(<TyreMeasurementForm onSave={vi.fn().mockRejectedValue({ status: 400, data: {
      code: 'HTTP_400', message: [
        'weightClass must be a valid enum value',
        'wheels.2.season must be a valid enum value',
        'wheels.2.construction must be a valid enum value',
        'wheels.2.winterMarking must be a valid enum value',
      ],
    } })} />)
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => {
      for (const label of ['Gewichtsklasse', 'Hinten links Saison', 'Hinten links Bauart', 'Hinten links Winterkennzeichnung']) {
        const select = screen.getByLabelText(label)
        expect(select).toHaveAttribute('aria-invalid', 'true')
        expect(select).toHaveAccessibleDescription('Bitte prüfen Sie diesen Wert.')
        expect(document.getElementById(select.getAttribute('aria-describedby')!)).toBeVisible()
      }
    })
    for (const field of ['Saison', 'Bauart', 'Winterkennzeichnung']) {
      expect(screen.getByLabelText(`Vorne links ${field}`)).toHaveAttribute('aria-invalid', 'false')
    }
  })

  it('focuses the first recognized validator field after saving and describes text-field errors', async () => {
    render(<TyreMeasurementForm onSave={vi.fn().mockRejectedValue({ status: 400, data: {
      code: 'HTTP_400', message: [
        'wheels.9.dot must be valid',
        'wheels.3.model must be a string',
        'weightClass must be a valid enum value',
        'wheels.0.dot must be a string',
      ],
    } })} />)
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(screen.getByLabelText('Hinten rechts Modell')).toHaveFocus())
    for (const label of ['Hinten rechts Modell', 'Vorne links DOT']) {
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription('Bitte prüfen Sie diesen Wert.')
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['wheels.9.dot', 'wheels.0.mediaId', 'wheels.0.position', 'wheels.0.unknown'])(
    'falls back to a root error for unsupported validator path %s', async (path) => {
      render(<TyreMeasurementForm onSave={vi.fn().mockRejectedValue({ status: 400, data: {
        code: 'HTTP_400', message: [`${path} must be valid`],
      } })} />)
      fillTreads()
      fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
      await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
      expect(screen.queryByText(`${path} must be valid`)).not.toBeInTheDocument()
      expect(screen.getByLabelText('Vorne links DOT')).toHaveAttribute('aria-invalid', 'false')
    },
  )

  it('maps a spare DOT error by position and focuses it only after saving finishes', async () => {
    let rejectSave!: (error: unknown) => void
    const onSave = () => new Promise((_, reject) => { rejectSave = reject })
    render(<TyreMeasurementForm onSave={onSave} />)
    fireEvent.click(screen.getByLabelText('Reserverad erfassen'))
    fillTreads()
    for (const point of ['Innen', 'Mitte', 'Außen']) {
      fireEvent.change(screen.getByLabelText(`Reserverad ${point}`), { target: { value: '5.25' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(screen.getByLabelText('Reserverad DOT')).toBeDisabled())
    rejectSave({ response: { status: 400, data: {
      code: 'TYRE_DOT_INVALID_WEEK', params: { position: 'SPARE' },
    } } })
    await waitFor(() => expect(screen.getByLabelText('Reserverad DOT')).toHaveFocus())
    expect(screen.getByLabelText('Reserverad DOT')).toBeEnabled()
    expect(screen.getByLabelText('Reserverad DOT')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a visible focus ring around the photo upload label', () => {
    render(<TyreMeasurementForm onSave={vi.fn()} onPhoto={vi.fn()} />)
    const input = screen.getByLabelText('Vorne links Reifenfoto aufnehmen')
    input.focus()
    expect(input).toHaveFocus()
    expect(input.closest('label')).toHaveClass('focus-within:ring-1', 'focus-within:ring-ring')
  })

  it('queues a photo for its wheel and prevents submission while that photo is pending', async () => {
    const onSave = vi.fn()
    const onPhoto = vi.fn().mockResolvedValue('pending-photo')
    const { rerender } = render(<TyreMeasurementForm onSave={onSave} onPhoto={onPhoto} pendingMediaIds={['pending-photo']} />)
    fireEvent.change(screen.getByLabelText('Vorne links Reifenfoto aufnehmen'), { target: { files: [new File(['photo'], 'tyre.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Messung speichern' })).toBeDisabled())
    rerender(<TyreMeasurementForm onSave={onSave} onPhoto={onPhoto} pendingMediaIds={[]} />)
    fillTreads()
    fireEvent.click(screen.getByRole('button', { name: 'Messung speichern' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ wheels: expect.arrayContaining([expect.objectContaining({ position: 'FL', mediaId: 'pending-photo' })]) })))
  })

  it('supports an optional spare and disables all entry fields in read-only mode', () => {
    const { rerender } = render(<TyreMeasurementForm onSave={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Reserverad erfassen'))
    expect(screen.getByLabelText('Reserverad Innen')).toBeVisible()
    rerender(<TyreMeasurementForm onSave={vi.fn()} disabled />)
    expect(screen.getByLabelText('Reserverad Innen')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Messung speichern' })).toBeDisabled()
  })
})

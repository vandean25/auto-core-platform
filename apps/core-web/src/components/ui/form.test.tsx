import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form'
import { Input } from './input'
import { expectFieldErrorLinked } from '@/test/form-a11y'

function NameForm() {
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => undefined)}>
        <FormField
          control={form.control}
          name="name"
          rules={{ required: 'Name is required' }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Save</button>
      </form>
    </Form>
  )
}

describe('Form', () => {
  it('links a failed field to its message and clears the link when valid', async () => {
    render(<NameForm />)
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('aria-invalid', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Name is required')
    expectFieldErrorLinked(input, 'Name is required')

    fireEvent.change(input, { target: { value: 'Ada' } })
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'false'))
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
    expect(input.getAttribute('aria-describedby') ?? '').not.toContain(`${input.id}-message`)
  })
})

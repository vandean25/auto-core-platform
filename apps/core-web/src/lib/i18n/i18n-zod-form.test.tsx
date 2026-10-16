import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useForm, type Resolver } from 'react-hook-form'
import { z } from 'zod'
import { changeUiLanguage, i18n } from '@/lib/i18n'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const emailSchema = z.object({ email: z.string().email() })

type EmailFormValues = z.infer<typeof emailSchema>

const zodEmailResolver: Resolver<EmailFormValues> = async (values) => {
  const result = emailSchema.safeParse(values)
  if (result.success) {
    return { values: result.data }
  }
  const message = result.error.issues[0]?.message ?? 'Invalid'
  return {
    values: {} as EmailFormValues,
    errors: {
      email: {
        type: 'custom',
        message,
      },
    },
  }
}

function EmailValidationForm() {
  const form = useForm<EmailFormValues>({
    defaultValues: { email: 'not-an-email' },
    resolver: zodEmailResolver,
    mode: 'onChange',
  })

  useEffect(() => {
    void form.trigger('email')
  }, [form])

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input aria-label="Email" {...field} />
            </FormControl>
            <FormMessage data-testid="email-error" />
          </FormItem>
        )}
      />
    </Form>
  )
}

describe('Zod locale with mounted forms', () => {
  it('revalidates visible errors in the active language without clearing values', async () => {
    await changeUiLanguage('de')
    render(<EmailValidationForm />)

    const input = screen.getByLabelText('Email')
    expect(input).toHaveValue('not-an-email')

    await waitFor(() => {
      expect(screen.getByTestId('email-error').textContent?.length).toBeGreaterThan(0)
    })
    const germanMessage = screen.getByTestId('email-error').textContent ?? ''
    expect(germanMessage.length).toBeGreaterThan(0)

    await changeUiLanguage('en')
    await waitFor(() => {
      const englishMessage = screen.getByTestId('email-error').textContent ?? ''
      expect(englishMessage).not.toBe(germanMessage)
      expect(englishMessage.toLowerCase()).toContain('email')
    })
    expect(input).toHaveValue('not-an-email')
  })

  it('loads namespaces already present for the previous language before switching', async () => {
    await changeUiLanguage('de')
    i18n.addResourceBundle('de', 'workshop', { smoke: { label: 'DE smoke' } }, true, true)
    i18n.addResourceBundle('en', 'workshop', { smoke: { label: 'EN smoke' } }, true, true)
    if (!i18n.options.ns?.includes('workshop')) {
      i18n.options.ns = [...(i18n.options.ns ?? []), 'workshop']
    }
    expect(i18n.getResourceBundle('de', 'workshop')?.smoke?.label).toBe('DE smoke')

    await changeUiLanguage('en')
    expect(i18n.getResourceBundle('en', 'workshop')?.smoke?.label).toBe('EN smoke')
  })
})

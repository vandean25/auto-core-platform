import { toast } from 'sonner'
import { Phone, Mail, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUpdateCustomer } from '@/api/customers'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TyreSetsSummary } from '@/features/tyre-storage/TyreSetsSummary'
import type { CustomerDetailResponse } from './customer-detail-model'

type EditableCustomerField =
  | 'company_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'vat_id'
  | 'address_street'
  | 'address_zip'
  | 'address_city'
  | 'address_country'

function useSaveCustomerField(customerId: string) {
  const { t } = useTranslation('customers')
  const updateCustomer = useUpdateCustomer()

  return async (field: EditableCustomerField, nextValue: string) => {
    try {
      await updateCustomer.mutateAsync({
        id: customerId,
        data: {
          [field]: nextValue,
        },
      })
      toast.success(t('detail.updated'))
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error(t('detail.updateFailed'))
      }
      throw error
    }
  }
}

export function CustomerContactCard({ customer }: { customer: CustomerDetailResponse }) {
  const { t } = useTranslation('customers')
  const handleSaveCustomerField = useSaveCustomerField(customer.id)

  return (
    <Card className='lg:col-span-1'>
      <CardHeader>
        <CardTitle className='text-base font-semibold'>{t('detail.contactInformation')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {customer.type === 'COMPANY' ? (
          <div className='space-y-2'>
            <div>
              <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.companyName')}</div>
              <InlineEdit
                value={customer.company_name}
                onSave={(nextValue) => handleSaveCustomerField('company_name', nextValue)}
                placeholder={t('detail.placeholders.companyName')}
                emptyText={t('detail.empty.companyName')}
                ariaLabel={t('detail.aria.companyName')}
              />
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
              <div>
                <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.contactFirstName')}</div>
                <InlineEdit
                  value={customer.first_name}
                  onSave={(nextValue) => handleSaveCustomerField('first_name', nextValue)}
                  placeholder={t('detail.placeholders.firstName')}
                  emptyText={t('detail.empty.firstName')}
                  ariaLabel={t('detail.aria.contactFirstName')}
                />
              </div>
              <div>
                <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.contactLastName')}</div>
                <InlineEdit
                  value={customer.last_name}
                  onSave={(nextValue) => handleSaveCustomerField('last_name', nextValue)}
                  placeholder={t('detail.placeholders.lastName')}
                  emptyText={t('detail.empty.lastName')}
                  ariaLabel={t('detail.aria.contactLastName')}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
            <div>
              <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.firstName')}</div>
              <InlineEdit
                value={customer.first_name}
                onSave={(nextValue) => handleSaveCustomerField('first_name', nextValue)}
                placeholder={t('detail.placeholders.firstName')}
                emptyText={t('detail.empty.firstName')}
                ariaLabel={t('detail.aria.firstName')}
              />
            </div>
            <div>
              <div className='text-xs text-muted-foreground mb-1'>{t('detail.fields.lastName')}</div>
              <InlineEdit
                value={customer.last_name}
                onSave={(nextValue) => handleSaveCustomerField('last_name', nextValue)}
                placeholder={t('detail.placeholders.lastName')}
                emptyText={t('detail.empty.lastName')}
                ariaLabel={t('detail.aria.lastName')}
              />
            </div>
          </div>
        )}
  
        <div className='flex items-center gap-2'>
          <Mail className='h-4 w-4 text-muted-foreground' />
          <InlineEdit
            value={customer.email}
            onSave={(nextValue) => handleSaveCustomerField('email', nextValue)}
            placeholder={t('detail.placeholders.email')}
            emptyText={t('detail.empty.email')}
            ariaLabel={t('detail.aria.email')}
          />
        </div>
        <div className='flex items-center gap-2'>
          <Phone className='h-4 w-4 text-muted-foreground' />
          <InlineEdit
            value={customer.phone}
            onSave={(nextValue) => handleSaveCustomerField('phone', nextValue)}
            placeholder={t('detail.placeholders.phone')}
            emptyText={t('detail.empty.phone')}
            ariaLabel={t('detail.aria.phone')}
            inputType="tel"
            autoComplete="tel"
          />
        </div>
        <TyreSetsSummary customerId={customer.id} />
        <div className='flex items-start gap-2'>
          <MapPin className='h-4 w-4 text-muted-foreground mt-1' />
          <div className='w-full space-y-1'>
            <InlineEdit
              mode='textarea'
              rows={3}
              value={customer.address_street}
              onSave={(nextValue) => handleSaveCustomerField('address_street', nextValue)}
              placeholder={t('detail.placeholders.street')}
              emptyText={t('detail.empty.street')}
              ariaLabel={t('detail.aria.street')}
            />
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
              <InlineEdit
                value={customer.address_zip}
                onSave={(nextValue) => handleSaveCustomerField('address_zip', nextValue)}
                placeholder={t('detail.placeholders.zip')}
                emptyText={t('detail.empty.zip')}
                ariaLabel={t('detail.aria.zip')}
              />
              <InlineEdit
                value={customer.address_city}
                onSave={(nextValue) => handleSaveCustomerField('address_city', nextValue)}
                placeholder={t('detail.placeholders.city')}
                emptyText={t('detail.empty.city')}
                ariaLabel={t('detail.aria.city')}
              />
            </div>
            <InlineEdit
              value={customer.address_country}
              onSave={(nextValue) => handleSaveCustomerField('address_country', nextValue)}
              placeholder={t('detail.placeholders.country')}
              emptyText={t('detail.empty.country')}
              ariaLabel={t('detail.aria.country')}
            />
          </div>
        </div>
        <div className='pt-2 border-t'>
          <span className='text-sm font-medium'>{t('detail.fields.vatId')}:</span>
          <div className='mt-1'>
            <InlineEdit
              value={customer.vat_id}
              onSave={(nextValue) => handleSaveCustomerField('vat_id', nextValue)}
              placeholder={t('detail.placeholders.vatId')}
              emptyText={t('detail.empty.vatId')}
              ariaLabel={t('detail.aria.vatId')}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

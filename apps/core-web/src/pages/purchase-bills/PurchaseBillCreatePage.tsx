import { useNavigate } from 'react-router-dom'
import { PurchaseBillForm } from '@/components/purchase-bills/PurchaseBillForm'
import type { PurchaseInvoice } from '@/api/types'

export default function PurchaseBillCreatePage() {
    const navigate = useNavigate()

    const handleSuccess = (invoice: PurchaseInvoice) => {
        navigate(`/purchase-bills/${invoice.id}`)
    }

    return (
        <PurchaseBillForm 
            onSuccess={handleSuccess} 
            onCancel={() => navigate('/purchase-bills')} 
        />
    )
}

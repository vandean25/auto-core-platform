import { useNavigate } from 'react-router-dom'
import { PurchaseBillForm } from '@/components/purchase-bills/PurchaseBillForm'
import type { PurchaseInvoice } from '@/api/types'

export default function PurchaseBillCreatePage() {
    const navigate = useNavigate()

    const handleSuccess = (invoice: PurchaseInvoice) => {
        navigate(`/purchase-bills/${invoice.id}`)
    }

    return (
        <div className="w-full max-w-page mx-auto p-6">
            <PurchaseBillForm 
                onSuccess={handleSuccess} 
                onCancel={() => navigate('/purchase-bills')} 
            />
        </div>
    )
}

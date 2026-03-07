import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function PurchaseBillCreatePage() {
    const navigate = useNavigate()

    return (
        <div className="w-full max-w-4xl mx-auto p-6 space-y-6">
            <Button variant="outline" onClick={() => navigate('/purchase-bills')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Bills
            </Button>

            <div className="bg-white rounded-lg border p-8">
                <h1 className="text-2xl font-semibold tracking-tight mb-2">Log New Bill</h1>
                <p className="text-slate-500 mb-8">Create a new vendor invoice for tracking and payment</p>

                <div className="space-y-6">
                    {/* Placeholder for form - to be implemented */}
                    <div className="p-8 border-2 border-dashed rounded-lg text-center text-slate-500">
                        <p>Bill creation form coming soon</p>
                    </div>
                </div>
            </div>
        </div>
    )
}

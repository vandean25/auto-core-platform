import { useState, useMemo } from 'react'
import type { InvoiceItem, Customer } from '../api/types'

export interface InvoiceEditorItem extends Omit<InvoiceItem, 'id'> {
    id?: string // Optional for new items
    tempId: string // For React keys
}

export function useInvoiceEditor() {
    const [customer, setCustomer] = useState<Customer | null>(null)
    const [date, setDate] = useState<Date>(new Date())
    const [dueDate, setDueDate] = useState<Date>(() => {
        const d = new Date()
        d.setDate(d.getDate() + 14)
        return d
    })
    const [items, setItems] = useState<InvoiceEditorItem[]>([])

    const totals = useMemo(() => {
        let subtotal = 0
        let taxTotal = 0

        items.forEach(item => {
            const lineTotal = item.quantity * item.unit_price
            const lineTax = lineTotal * (item.tax_rate / 100)
            subtotal += lineTotal
            taxTotal += lineTax
        })

        return {
            subtotal,
            taxTotal,
            total: subtotal + taxTotal
        }
    }, [items])

    const addItem = () => {
        setItems(prev => [
            ...prev,
            {
                tempId: crypto.randomUUID(),
                description: '',
                quantity: 1,
                unit_price: 0,
                tax_rate: 20
            }
        ])
    }

    const updateItem = (index: number, updates: Partial<InvoiceEditorItem>) => {
        setItems(prev => {
            const newItems = [...prev]
            newItems[index] = { ...newItems[index], ...updates }
            return newItems
        })
    }

    const removeItem = (index: number) => {
        setItems(prev => prev.filter((_, i) => i !== index))
    }

    const isValid = useMemo(() => {
        return !!customer && items.length > 0 && items.every(i => i.description.trim() !== '')
    }, [customer, items])

    return {
        customer,
        setCustomer,
        date,
        setDate,
        dueDate,
        setDueDate,
        items,
        addItem,
        updateItem,
        removeItem,
        totals,
        isValid
    }
}

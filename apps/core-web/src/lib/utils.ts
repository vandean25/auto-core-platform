import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function getPOStatusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
    switch (status) {
        case 'COMPLETED':
            return 'default'
        case 'PARTIAL':
            return 'secondary'
        case 'SENT':
            return 'outline'
        case 'DRAFT':
            return 'outline'
        default:
            return 'outline'
    }
}

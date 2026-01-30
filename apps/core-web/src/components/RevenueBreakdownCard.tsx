import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { useRevenueAnalytics } from "@/api/useFinance"
import { Loader2 } from "lucide-react"

export function RevenueBreakdownCard() {
    const { data, isLoading } = useRevenueAnalytics()

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[350px] border rounded-xl bg-white shadow-sm">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!data || data.data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[350px] border rounded-xl bg-white shadow-sm p-8 text-center">
                <p className="text-muted-foreground">No revenue data for this month yet.</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col border rounded-xl bg-white shadow-sm overflow-hidden h-[350px]">
            <div className="p-6 pb-0">
                <h3 className="font-semibold text-lg">Revenue This Month</h3>
                <p className="text-sm text-muted-foreground">{data.period}</p>
            </div>
            <div className="flex-1 relative">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data.data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                        >
                            {data.data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip 
                            formatter={(value: number | undefined) => [value ? `€${value.toLocaleString()}` : "€0", 'Revenue']}
                        />
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-bold">€{data.total.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground uppercase">Total</span>
                </div>
            </div>
            <div className="p-6 pt-0 flex flex-wrap justify-center gap-4">
                {data.data.map((item, index) => (
                    <div key={index} className="flex items-center gap-1.5 text-xs font-medium">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span>{item.name.split(' ')[0]}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

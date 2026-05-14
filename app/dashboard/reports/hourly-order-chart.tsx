"use client"

import { useState, useEffect } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { formatDateInput } from "@/lib/date-calender"

type HourlyData = {
    hour: string;
    orders: number;
}

const EMPTY_DATA: HourlyData[] = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    orders: 0,
}));

const chartConfig = {
    orders: {
        label: "Jumlah Order",
        color: "hsl(var(--chart-1))",
    },
} satisfies ChartConfig

export default function HourlyOrderChart() {
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [data, setData] = useState<HourlyData[]>(EMPTY_DATA);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const date = formatDateInput(selectedDate);
        setIsLoading(true);
        setError(null);
        fetch(`/api/get-hourly-orders?date=${date}&timezone=${encodeURIComponent(timezone)}`)
            .then(async r => {
                const j = await r.json();
                if (!r.ok) {
                    setError(j.error ?? `HTTP ${r.status}`);
                    setData(EMPTY_DATA);
                } else {
                    setData(j.data ?? EMPTY_DATA);
                }
            })
            .catch(e => {
                setError(e.message);
                setData(EMPTY_DATA);
            })
            .finally(() => setIsLoading(false));
    }, [selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()]);

    const totalOrders = data.reduce((sum, d) => sum + d.orders, 0);
    const peakHour = data.reduce((max, d) => d.orders > max.orders ? d : max, data[0]);

    const formattedDate = selectedDate.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });

    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-start justify-between">
                <div>
                    <CardTitle>Order per Jam</CardTitle>
                    <CardDescription>{formattedDate}</CardDescription>
                </div>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            Pilih Tanggal
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={(d) => { if (d) setSelectedDate(d); }}
                        />
                    </PopoverContent>
                </Popover>
            </CardHeader>
            <CardContent>
                <ChartContainer config={chartConfig} className={`h-[220px] w-full transition-opacity ${isLoading ? "opacity-40 pointer-events-none" : "opacity-100"}`}>
                    <BarChart data={data} margin={{ left: 0, right: 8 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                            dataKey="hour"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(v) => v.slice(0, 2)}
                            interval={1}
                            tick={{ fontSize: 11 }}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={4}
                            allowDecimals={false}
                            width={24}
                            tick={{ fontSize: 11 }}
                        />
                        <ChartTooltip
                            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                            content={<ChartTooltipContent />}
                        />
                        <Bar dataKey="orders" fill="var(--color-orders)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ChartContainer>
                {error && (
                    <p className="mt-2 text-xs text-destructive">Error: {error}</p>
                )}
                <div className="mt-4 flex gap-6 text-sm text-muted-foreground">
                    <span>Total hari ini: <span className="font-semibold text-foreground">{totalOrders} order</span></span>
                    <span>Jam tersibuk: <span className="font-semibold text-foreground">{peakHour.hour}</span></span>
                </div>
            </CardContent>
        </Card>
    )
}

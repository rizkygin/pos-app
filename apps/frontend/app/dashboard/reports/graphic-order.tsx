"use client"

import { useEffect, useState } from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig, } from "@/components/ui/chart"
import { TrendingUp, TrendingDown } from "lucide-react"

type chartDataType = [{
    month: string;
    count_order: number;
    total_terjual: string;
}]


const chartConfig = {
    total_terjual: {
        label: "Penghasilan",
        color: "red",
    },
    count_order: {
        label: "Produk Terjual",
        color: "green",
    }
} satisfies ChartConfig


export default function GraphicOrder() {
    const [chartData, setChartData] = useState<chartDataType>();


    const getChartData = async () => {
        const response = await fetch("/api/get-data-chart");
        const data = await response.json();
        setChartData(data.data);
    }

    useEffect(() => {
        getChartData();

    }, []);

    const currentMonthTotal = Number(chartData?.[chartData.length - 1]?.total_terjual || 0);
    const previousMonthTotal = Number(chartData?.[chartData.length - 2]?.total_terjual || 0);

    let trendPercentage = 0;
    if (previousMonthTotal > 0) {
        trendPercentage = ((currentMonthTotal - previousMonthTotal) / previousMonthTotal) * 100;
    } else if (currentMonthTotal > 0) {
        trendPercentage = 100;
    }

    const isTrendingUp = trendPercentage >= 0;

    return (
        <Card className="w-full lg:w-[380px] lg:shrink-0">
            {/* chart penjualan */}
            <div>
                <CardHeader>
                    <CardTitle>Tabel Penghasilan</CardTitle>
                    <CardDescription>
                        Penghasilan per bulan selama 6 bulan terakhir
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ChartContainer config={chartConfig}>
                        <AreaChart
                            accessibilityLayer
                            data={chartData}
                            margin={{
                                left: 12,
                                right: 12,
                            }}
                        >
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="month"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                tickFormatter={(value) => value.slice(0, 3)}
                            />
                            <ChartTooltip
                                cursor={false}
                                content={<ChartTooltipContent indicator="line" />}
                            />
                            <Area
                                dataKey="total_terjual"
                                type="natural"
                                fill="var(--color-total_terjual)"
                                fillOpacity={0.4}
                                stroke="var(--color-total_terjual)"
                            />
                        </AreaChart>
                    </ChartContainer>
                </CardContent>
                <CardFooter>
                    <div className="flex w-full items-start gap-2 text-sm">
                        <div className="grid gap-2">
                            <div className="flex items-center gap-2 leading-none font-medium">
                                Trending {isTrendingUp ? 'up' : 'down'} by {Math.abs(trendPercentage).toFixed(1)}% this month {isTrendingUp ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                            </div>
                            <div className="flex items-center gap-2 leading-none text-muted-foreground">
                                {chartData?.[0]?.month} - {chartData?.[chartData.length - 1]?.month} {new Date().getFullYear()}
                            </div>
                        </div>
                    </div>
                </CardFooter>
            </div>
            {/* chart order */}
            <div>
                <CardHeader>
                    <CardTitle>Tabel Order</CardTitle>
                    <CardDescription>
                        Jumlah order per bulan selama 6 bulan terakhir
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ChartContainer config={chartConfig}>
                        <AreaChart
                            accessibilityLayer
                            data={chartData}
                            margin={{
                                left: 12,
                                right: 12,
                            }}
                        >
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="month"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                tickFormatter={(value) => value.slice(0, 3)}
                            />
                            <ChartTooltip
                                cursor={false}
                                content={<ChartTooltipContent indicator="line" />}
                            />
                            <Area
                                dataKey="count_order"
                                type="linear"
                                fill="var(--color-count_order)"
                                fillOpacity={0.4}
                                stroke="var(--color-count_order)"
                            />
                        </AreaChart>
                    </ChartContainer>
                </CardContent>
                <CardFooter>
                    <div className="flex w-full items-start gap-2 text-sm">
                        <div className="grid gap-2">
                            <div className="flex items-center gap-2 leading-none font-medium">
                                Trending {isTrendingUp ? 'up' : 'down'} by {Math.abs(trendPercentage).toFixed(1)}% this month {isTrendingUp ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                            </div>
                            <div className="flex items-center gap-2 leading-none text-muted-foreground">
                                {chartData?.[0]?.month} - {chartData?.[chartData.length - 1]?.month} {new Date().getFullYear()}
                            </div>
                        </div>
                    </div>
                </CardFooter>
            </div>


        </Card>
    );
}
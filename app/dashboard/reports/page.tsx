"use client"

import { TrendingUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig, } from "@/components/ui/chart"
import { columns } from "./columns"
import { DataTable } from "./data-table"
import { useEffect, useState } from "react"
export const description = "A simple area chart"

const chartData = [
    { month: "January", desktop: 186 },
    { month: "February", desktop: 305 },
    { month: "March", desktop: 237 },
    { month: "April", desktop: 73 },
    { month: "May", desktop: 209 },
    { month: "June", desktop: 214 },
]

const chartConfig = {
    desktop: {
        label: "Desktop",
        color: "var(--chart-1)",
    },
} satisfies ChartConfig

export function Reports() {
    const [data, setData] = useState<[]>([]);
    const [isForbidden, setIsForbidden] = useState(false);

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [count, setCount] = useState(0);
    const [search, setSearch] = useState('');
    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const res = await fetch(`/api/get-data-order?page=${page}&limit=${limit}&search=${search}`, {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json"
                    }
                });
                const result = await res.json();
                if (result.success) {
                    setData(result.data);
                    setCount(result.count);
                } else if (res.status === 401 || res.status === 403) {
                    setIsForbidden(true);
                }
            } catch (error) {
                console.error("Failed to fetch orders:", error);
            }
        };

        fetchOrders();
    }, [page, limit, count, search]);

    if (isForbidden) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <p className="text-destructive">You are not authorized to view this page.</p>
            </div>
        );
    }


    return (
        <div>
            <div className="flex w-full max-h-[calc(100vh-4rem)] ">
                <Card className="mx-5 w-full ">
                    <CardHeader>
                        <CardTitle>Area Chart</CardTitle>
                        <CardDescription>
                            Showing total visitors for the last 6 months
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
                                    dataKey="desktop"
                                    type="natural"
                                    fill="var(--color-desktop)"
                                    fillOpacity={0.4}
                                    stroke="var(--color-desktop)"
                                />
                            </AreaChart>
                        </ChartContainer>
                    </CardContent>
                    <CardFooter>
                        <div className="flex w-full items-start gap-2 text-sm">
                            <div className="grid gap-2">
                                <div className="flex items-center gap-2 leading-none font-medium">
                                    Trending up by 5.2% this month <TrendingUp className="h-4 w-4" />
                                </div>
                                <div className="flex items-center gap-2 leading-none text-muted-foreground">
                                    January - June 2024
                                </div>
                            </div>
                        </div>
                    </CardFooter>
                </Card>
                <div className="mx-5 w-full h-full">
                    <label className="text-xl font-semibold">Produk Terjual</label>
                    {/* //search products */}
                    <div className="flex items-center py-4">
                        <Input
                            placeholder="Cari produk..."
                            value={search}
                            onChange={(e) =>
                                setSearch(e.target.value)
                            }
                            className="max-w-sm"
                        />
                    </div>
                    <DataTable columns={columns} data={data} page={page} limit={limit} count={count} setPage={setPage} setLimit={setLimit} />
                    {/* //last order table using shadCN table */}

                </div>
            </div>

        </div>



    )
}

export default Reports;

"use client"

import { Input } from "@/components/ui/input"
import { columns } from "./columns"
import { DataTable } from "./data-table"
import GraphicOrder from "./graphic-order"
import { useEffect, useState } from "react"
export const description = "A simple area chart"



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
        <div className="w-full h-full p-5">
            <div className="flex w-full h-full">
                <GraphicOrder />
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

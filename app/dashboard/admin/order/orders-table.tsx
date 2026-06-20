'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/app/dashboard/reports/data-table';
import { AdminOrder, columns } from './columns';

export const OrdersTable = () => {
  const router = useRouter();
  const [data, setData] = useState<AdminOrder[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
      });
      if (status) params.set('status', status);
      if (type) params.set('type', type);

      const res = await fetch(`/api/admin/orders?${params.toString()}`);
      const result = await res.json();
      if (result.success) {
        setData(result.data);
        setCount(result.count);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, search, status, type]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-50">
          <label className="text-xs font-bold text-muted-foreground">Cari</label>
          <Input
            placeholder="Cari ID pesanan, nama pelanggan, outlet..."
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground">Tipe</label>
          <select
            value={type}
            onChange={(e) => {
              setPage(1);
              setType(e.target.value);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="">Semua Tipe</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="">Semua Status</option>
            <option value="pending">Menunggu</option>
            <option value="confirmed">Dikonfirmasi</option>
            <option value="preparing">Diproses</option>
            <option value="ready">Siap</option>
            <option value="on_delivery">Diantar</option>
            <option value="delivered">Selesai</option>
            <option value="cancelled">Dibatalkan</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          page={page}
          limit={limit}
          count={count}
          setPage={setPage}
          setLimit={() => {}}
          onRowClick={(row) => router.push(`/dashboard/admin/order/${row.id}`)}
        />
      )}
    </div>
  );
};

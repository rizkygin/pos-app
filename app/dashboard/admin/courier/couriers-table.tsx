'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/app/dashboard/reports/data-table';
import { AdminCourier, getColumns } from './columns';

export const CouriersTable = () => {
  const [data, setData] = useState<AdminCourier[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [minRating, setMinRating] = useState('');

  const fetchCouriers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
      });
      if (minRating) params.set('minRating', minRating);

      const res = await fetch(`/api/admin/couriers?${params.toString()}`);
      const result = await res.json();
      if (result.success) {
        setData(result.data);
        setCount(result.count);
      }
    } catch (error) {
      console.error('Failed to fetch couriers:', error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, minRating]);

  useEffect(() => {
    fetchCouriers();
  }, [fetchCouriers]);

  const columns = getColumns(fetchCouriers);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-50">
          <label className="text-xs font-bold text-muted-foreground">Cari</label>
          <Input
            placeholder="Cari nama, email, telepon, plat nomor..."
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground">Rating Min</label>
          <select
            value={minRating}
            onChange={(e) => {
              setPage(1);
              setMinRating(e.target.value);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="">Semua Rating</option>
            {[4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>
                {r}+ ★
              </option>
            ))}
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
        />
      )}
    </div>
  );
};

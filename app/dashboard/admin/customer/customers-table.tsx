'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/app/dashboard/reports/data-table';
import { AdminCustomer, getColumns } from './columns';

export const CustomersTable = () => {
  const [data, setData] = useState<AdminCustomer[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
      });

      const res = await fetch(`/api/admin/customers?${params.toString()}`);
      const result = await res.json();
      if (result.success) {
        setData(result.data);
        setCount(result.count);
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const columns = getColumns(fetchCustomers);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-50">
          <label className="text-xs font-bold text-muted-foreground">Cari</label>
          <Input
            placeholder="Cari nama, email, telepon..."
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
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

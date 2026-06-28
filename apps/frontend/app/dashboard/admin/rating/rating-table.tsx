'use client';

import { useEffect, useState } from 'react';
import { Loader2, Star, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/app/dashboard/reports/data-table';
import { RatingProduct, getColumns } from './columns';
import { API_URL } from '@/lib/api-url';

type Outlet = { id: number; name: string };

type RatingRow = {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  reviewer_name: string;
};

export const RatingTable = () => {
  const [data, setData] = useState<RatingProduct[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [outletId, setOutletId] = useState('');
  const [minRating, setMinRating] = useState('');

  const [ratingProduct, setRatingProduct] = useState<RatingProduct | null>(null);
  const [ratingData, setRatingData] = useState<{
    data: RatingRow[];
    total: number;
    average: number;
  } | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
      });
      if (outletId) params.set('outletId', outletId);
      if (minRating) params.set('minRating', minRating);

      const res = await fetch(`${API_URL}/api/admin/products?${params.toString()}`, {
        credentials: 'include',
      });
      const result = await res.json();
      if (result.success) {
        setData(result.data);
        setCount(result.count);
        setOutlets(result.outlets);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, search, outletId, minRating]);

  const handleShowRating = async (product: RatingProduct) => {
    setRatingProduct(product);
    setRatingLoading(true);
    setRatingData(null);
    try {
      const res = await fetch(
        `${API_URL}/api/admin/product-ratings?productId=${product.id}`,
        { credentials: 'include' },
      );
      const result = await res.json();
      if (result.success) {
        setRatingData(result);
      }
    } finally {
      setRatingLoading(false);
    }
  };

  const closeRating = () => {
    setRatingProduct(null);
    setRatingData(null);
  };

  const columns = getColumns({ onShowRating: handleShowRating });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-bold text-muted-foreground">Cari</label>
          <Input
            placeholder="Cari produk atau outlet..."
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-muted-foreground">Outlet</label>
          <select
            value={outletId}
            onChange={(e) => {
              setPage(1);
              setOutletId(e.target.value);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="">Semua Outlet</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
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
          setLimit={setLimit}
        />
      )}

      {/* Rating Modal */}
      {ratingProduct && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closeRating}
          />
          <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">{ratingProduct.product_name}</h3>
              <button
                onClick={closeRating}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {ratingLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : ratingData ? (
              <>
                <div className="flex items-center gap-2">
                  <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                  <span className="text-xl font-black">
                    {ratingData.average.toFixed(1)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    ({ratingData.total} ulasan)
                  </span>
                </div>

                <div className="space-y-3">
                  {ratingData.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada ulasan.</p>
                  ) : (
                    ratingData.data.map((r) => (
                      <div key={r.id} className="border-b pb-3 last:border-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm">{r.reviewer_name}</span>
                          <div className="flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                            <span className="text-xs font-medium">{r.rating}</span>
                          </div>
                        </div>
                        {r.comment && (
                          <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>
                        )}
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          {new Date(r.created_at).toLocaleDateString('id-ID', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};

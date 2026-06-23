'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/app/dashboard/reports/data-table';
import { AdminAd, getColumns } from './columns';
import { approveAdAction, deleteAdAction, rejectAdAction } from './actions';

export const PromoteAdsTable = () => {
  const [data, setData] = useState<AdminAd[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const [rejectingAd, setRejectingAd] = useState<AdminAd | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchAds = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (status) params.set('status', status);

      const res = await fetch(`/api/admin/ads?${params.toString()}`);
      const result = await res.json();
      if (result.success) {
        setData(result.data);
        setCount(result.count);
      }
    } catch (error) {
      console.error('Failed to fetch ads:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, status]);

  const handleApprove = async (ad: AdminAd) => {
    const result = await approveAdAction(ad.id);
    if (result.success) {
      fetchAds();
    } else {
      alert(result.message);
    }
  };

  const handleDelete = async (ad: AdminAd) => {
    if (!window.confirm(`Hapus iklan "${ad.title}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    const result = await deleteAdAction(ad.id);
    if (result.success) {
      fetchAds();
    } else {
      alert(result.message);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectingAd) return;
    if (!rejectReason.trim()) {
      alert('Mohon isi alasan penolakan.');
      return;
    }
    setIsSubmitting(true);
    const result = await rejectAdAction(rejectingAd.id, rejectReason.trim());
    setIsSubmitting(false);
    if (result.success) {
      setRejectingAd(null);
      setRejectReason('');
      fetchAds();
    } else {
      alert(result.message);
    }
  };

  const columns = getColumns({
    onApprove: handleApprove,
    onReject: (ad) => {
      setRejectingAd(ad);
      setRejectReason('');
    },
    onDelete: handleDelete,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
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
            <option value="approved">Disetujui</option>
            <option value="rejected">Ditolak</option>
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

      {/* Reject Modal */}
      {rejectingAd && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setRejectingAd(null)}
          />
          <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">Tolak Iklan</h3>
              <button
                onClick={() => setRejectingAd(null)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Alasan Penolakan</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-none"
                placeholder="Jelaskan alasan penolakan..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRejectingAd(null)}>
                Batal
              </Button>
              <Button variant="destructive" onClick={handleRejectSubmit} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Tolak
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

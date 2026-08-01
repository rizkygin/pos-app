'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/app/dashboard/reports/data-table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { API_URL } from '@/lib/api-url';
import { AdminCourier, getColumns } from './columns';
import { VerificationReview } from './verification-review';

export const CourierTable = () => {
  const [data, setData] = useState<AdminCourier[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const [viewing, setViewing] = useState<AdminCourier | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [editing, setEditing] = useState<AdminCourier | null>(null);
  const [deleting, setDeleting] = useState<AdminCourier | null>(null);
  const [form, setForm] = useState<{ vehicle_plate: string; vehicle_type: 'car' | 'motorcycle' }>({
    vehicle_plate: '',
    vehicle_type: 'motorcycle',
  });
  const [saving, setSaving] = useState(false);

  const fetchCouriers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), search });
      const res = await fetch(`${API_URL}/api/admin/couriers?${params.toString()}`, { credentials: 'include' });
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
  };

  useEffect(() => {
    fetchCouriers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, search]);

  const openEdit = (courier: AdminCourier) => {
    setEditing(courier);
    setForm({ vehicle_plate: courier.vehicle_plate, vehicle_type: courier.vehicle_type });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/couriers/update`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, ...form }),
      });
      const result = await res.json();
      if (result.success) {
        setEditing(null);
        fetchCouriers();
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/couriers/delete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleting.id }),
      });
      const result = await res.json();
      if (result.success) {
        setDeleting(null);
        fetchCouriers();
      }
    } finally {
      setSaving(false);
    }
  };

  const columns = getColumns({
    onView: setViewing,
    onEdit: openEdit,
    onDelete: setDeleting,
    onVerify: (courier) => setVerifying(courier.id),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-bold text-muted-foreground">Cari</label>
          <Input
            placeholder="Cari nama, email, plat nomor..."
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
          setLimit={setLimit}
        />
      )}

      {verifying !== null && (
        <VerificationReview
          courierId={verifying}
          onClose={() => setVerifying(null)}
          // Refetch rather than patch the row: approving also clears the note
          // and stamps verified_at, and the list is the thing an admin scans
          // next.
          onSaved={fetchCouriers}
        />
      )}

      {viewing && (
        <Overlay title={viewing.name} onClose={() => setViewing(null)}>
          <DetailRow label="Email" value={viewing.email} />
          <DetailRow label="Telepon" value={viewing.phone || '—'} />
          <DetailRow label="Plat Nomor" value={viewing.vehicle_plate} />
          <DetailRow label="Jenis Kendaraan" value={viewing.vehicle_type === 'car' ? 'Mobil' : 'Motor'} />
          <DetailRow label="Rating" value={`${Number(viewing.ratings ?? 5).toFixed(1)} (${viewing.review_count} ulasan)`} />
          <DetailRow
            label="Terdaftar"
            value={viewing.created_at ? new Date(viewing.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
          />
        </Overlay>
      )}

      {editing && (
        <Overlay title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <Field label="Plat Nomor">
            <Input value={form.vehicle_plate} onChange={(e) => setForm((f) => ({ ...f, vehicle_plate: e.target.value }))} />
          </Field>
          <Field label="Jenis Kendaraan">
            <select
              value={form.vehicle_type}
              onChange={(e) => setForm((f) => ({ ...f, vehicle_type: e.target.value as 'car' | 'motorcycle' }))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="motorcycle">Motor</option>
              <option value="car">Mobil</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Batal
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan'}
            </Button>
          </div>
        </Overlay>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus kurir ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} akan dihapus dari daftar kurir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-bold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

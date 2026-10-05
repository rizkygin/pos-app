'use client';

import { Fragment, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DashboardHeader } from '@/components/dashboard-header';
import { LocalDateTime } from '@/components/local-datetime';
import { API_URL } from '@/lib/api-url';

export type ActivityRow = {
  id: number;
  admin_email: string | null;
  action: string;
  target: string | null;
  detail: unknown;
  status_code: number | null;
  ip_address: string | null;
  user_agent: string | null;
  createdAt: string;
};

const PAGE_SIZE = 50;

// The backend stores "METHOD /route/pattern" (or an event name); this is the
// readable version. Anything missing here shows the raw value, so a new route
// is never invisible — just unlabelled.
const ACTION_LABELS: Record<string, string> = {
  login: 'Masuk',
  'two_factor.enabled': 'Verifikasi dua langkah diaktifkan',
  'two_factor.disabled': 'Verifikasi dua langkah dimatikan',
  'two_factor.backup_codes_regenerated': 'Kode cadangan dibuat ulang',
  'script.grant': 'Hak admin diberikan (skrip server)',
  'script.revoke': 'Hak admin dicabut (skrip server)',
  'script.reset-2fa': 'Verifikasi dua langkah direset (skrip server)',
  'POST /api/admin/reauth': 'Konfirmasi password',
  'POST /api/admin/security/sign-out-others': 'Keluarkan perangkat lain',
  'POST /api/admin/set-recommended': 'Ubah menu rekomendasi',
  'POST /api/admin/update-product': 'Ubah produk',
  'POST /api/admin/couriers/update': 'Ubah data kurir',
  'POST /api/admin/couriers/:id/verify': 'Verifikasi kurir',
  'POST /api/admin/couriers/:id/documents': 'Unggah dokumen kurir',
  'POST /api/admin/couriers/:id/avatar': 'Unggah foto kurir',
  'POST /api/admin/couriers/delete': 'Hapus kurir',
  'POST /api/admin/customers/delete': 'Hapus pelanggan',
  'POST /api/admin/users/update': 'Ubah user',
  'POST /api/admin/users/delete': 'Hapus user',
  'PUT /api/admin/service-area': 'Ubah area layanan',
  'PUT /api/admin/outlet/:outletId/reachable': 'Ubah jangkauan outlet',
  'POST /api/admin/outlets/:id/reset': 'Reset data outlet',
  'POST /api/ads/approve': 'Setujui iklan',
  'POST /api/ads/reject': 'Tolak iklan',
  'POST /api/ads/admin-delete': 'Hapus iklan',
  'POST /api/admin/maintenance': 'Jadwalkan pemeliharaan',
  'POST /api/admin/maintenance/:id/end': 'Akhiri pemeliharaan',
  'POST /api/admin/subscription-deals': 'Beri penawaran langganan',
  'POST /api/admin/subscription-employee-cap': 'Ubah batas karyawan',
  'POST /api/admin/subscription-payments/:id/confirm': 'Konfirmasi pembayaran langganan',
  'POST /api/admin/subscription-payments/:id/reject': 'Tolak pembayaran langganan',
  'GET /api/audit/duplicate-orders/:outletId': 'Lihat audit order outlet merchant',
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? (action.startsWith('GET ') ? 'Lihat data merchant' : action);
}

function statusBadge(code: number | null) {
  if (code == null) return null;
  const ok = code < 400;
  return (
    <span
      className={
        ok
          ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      }
    >
      {ok ? 'Berhasil' : `Gagal (${code})`}
    </span>
  );
}

type Loaded = { key: string; rows: ActivityRow[]; count: number; error: string | null };

export function AdminActivityLog({ initialRows, initialCount }: { initialRows: ActivityRow[]; initialCount: number }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  // Wait for typing to pause before searching.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // The first page with no search is what the server rendered; anything else
  // is fetched, and the previous result stays on screen until it arrives.
  const isInitial = page === 1 && search === '';
  const key = `${page}|${search}`;

  useEffect(() => {
    if (isInitial) return;
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), q: search });
    fetch(`${API_URL}/api/admin/activity?${params}`, { credentials: 'include' })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? 'Gagal memuat');
        if (!cancelled) setLoaded({ key, rows: body.data ?? [], count: body.count ?? 0, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setLoaded((prev) => ({
            key,
            rows: prev?.rows ?? [],
            count: prev?.count ?? 0,
            error: e instanceof Error ? e.message : 'Gagal memuat',
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isInitial, key, page, search]);

  const loading = !isInitial && loaded?.key !== key;
  const rows = isInitial ? initialRows : (loaded?.rows ?? []);
  const count = isInitial ? initialCount : (loaded?.count ?? 0);
  const error = !isInitial && loaded?.key === key ? loaded.error : null;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="pb-16">
      <DashboardHeader
        title="Aktivitas Admin"
        description="Catatan semua tindakan admin: login, perubahan data, konfirmasi password, dan pembacaan data merchant. Catatan tidak bisa diubah atau dihapus dari aplikasi."
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari email, tindakan, atau target"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {loading && <Loader2 className="mr-1 inline size-4 animate-spin" />}
          {count} catatan
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Waktu</th>
              <th className="px-4 py-3 font-medium">Admin</th>
              <th className="px-4 py-3 font-medium">Tindakan</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Hasil</th>
              <th className="px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Belum ada catatan.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                  onClick={() => setOpenId(openId === row.id ? null : row.id)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    <LocalDateTime
                      value={row.createdAt}
                      options={{ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {/* Table cells ignore max-width; an inner block does not. */}
                    <div className="max-w-[180px] break-all">{row.admin_email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{actionLabel(row.action)}</div>
                    {actionLabel(row.action) !== row.action && (
                      <div className="font-mono text-xs text-muted-foreground">{row.action}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <div className="max-w-[160px] truncate" title={row.target ?? ''}>
                      {row.target ?? '—'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{statusBadge(row.status_code)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={row.user_agent ?? ''}>
                    {row.ip_address ?? '—'}
                  </td>
                </tr>
                {openId === row.id && (
                  <tr className="border-b border-border bg-muted/30">
                    <td colSpan={6} className="px-4 py-3">
                      <p className="mb-1 text-xs text-muted-foreground">Perangkat: {row.user_agent ?? '—'}</p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs text-foreground">
                        {row.detail ? JSON.stringify(row.detail, null, 2) : 'Tidak ada detail.'}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="size-4" />
          Sebelumnya
        </Button>
        <span className="text-sm text-muted-foreground">
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
          Berikutnya
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

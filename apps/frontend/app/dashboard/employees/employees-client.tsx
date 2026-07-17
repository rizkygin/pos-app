'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Plus,
  Loader2,
  KeyRound,
  UserX,
  UserCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_URL } from '@/lib/api-url';

// Mirrors EMPLOYEE_PERMISSIONS in the backend (lib/outlet-access.ts) — the
// order here is the display order of the toggles.
const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'cashier', label: 'Kasir' },
  { key: 'activeOrders', label: 'Pesanan Aktif' },
  { key: 'products', label: 'Produk' },
  { key: 'stock', label: 'Stok' },
  { key: 'salesInvoice', label: 'Faktur Penjualan' },
  { key: 'purchaseInvoice', label: 'Faktur Pembelian' },
  { key: 'reports', label: 'Laporan' },
  { key: 'cashflow', label: 'Buku Kas' },
];

type Employee = {
  id: number;
  name: string;
  email: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
  created_at: string;
};

export function EmployeesClient() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [maxEmployees, setMaxEmployees] = useState(1);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  // add form
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [addPerms, setAddPerms] = useState<Record<string, boolean>>({ cashier: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/employees`, { credentials: 'include' });
    const json = await res.json();
    if (json.success) {
      setRows(json.data);
      setMaxEmployees(json.max_employees ?? 1);
      setActiveCount(json.active_count ?? 0);
    }
  }, []);

  useEffect(() => {
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const addEmployee = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/employees`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, permissions: addPerms }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Gagal menambah karyawan');
        return;
      }
      setName('');
      setEmail('');
      setPassword('');
      setAddPerms({ cashier: true });
      setShowAdd(false);
      await fetchAll();
    } catch {
      setError('Gagal terhubung ke server');
    } finally {
      setSaving(false);
    }
  };

  // Immediate save per toggle — small lists, no batching needed.
  const togglePerm = async (emp: Employee, key: string) => {
    const permissions = { ...emp.permissions, [key]: !emp.permissions?.[key] };
    setRows((prev) => prev.map((r) => (r.id === emp.id ? { ...r, permissions } : r)));
    const res = await fetch(`${API_URL}/api/employees/${emp.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions }),
    });
    if (!res.ok) await fetchAll(); // revert on failure
  };

  const setActive = async (emp: Employee, is_active: boolean) => {
    if (
      !is_active &&
      !window.confirm(`Nonaktifkan ${emp.name}? Sesi login mereka langsung diputus.`)
    )
      return;
    setBusyId(emp.id);
    try {
      const res = await fetch(`${API_URL}/api/employees/${emp.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active }),
      });
      const json = await res.json();
      if (!json.success) alert(json.error || 'Gagal');
      await fetchAll();
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (emp: Employee) => {
    const pw = window.prompt(`Password baru untuk ${emp.name} (min. 8 karakter):`);
    if (pw === null) return;
    setBusyId(emp.id);
    try {
      const res = await fetch(`${API_URL}/api/employees/${emp.id}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const json = await res.json();
      alert(json.success ? 'Password diganti — karyawan harus login ulang.' : json.error || 'Gagal');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const capReached = activeCount >= maxEmployees;

  return (
    <div className="space-y-4">
      {/* header: cap + add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-bold text-foreground">{activeCount}</span> dari{' '}
          <span className="font-bold text-foreground">{maxEmployees}</span> karyawan aktif
          {capReached && (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              batas paket tercapai — upgrade untuk menambah
            </span>
          )}
        </p>
        <Button
          onClick={() => setShowAdd((v) => !v)}
          disabled={capReached && !showAdd}
          className="bg-foreground text-background hover:opacity-85"
        >
          <Plus className="size-4" /> Tambah Karyawan
        </Button>
      </div>

      {/* add form */}
      {showAdd && (
        <div className="rounded-2xl border p-4">
          <p className="text-sm font-bold">Karyawan Baru</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Pian yang membuat akunnya — berikan email & password ini ke karyawan untuk login.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Input placeholder="Nama" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              placeholder="Email login"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="relative">
              <Input
                placeholder="Password (min. 8)"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PERMISSIONS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setAddPerms((prev) => ({ ...prev, [p.key]: !prev[p.key] }))}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  addPerms[p.key]
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>
              Batal
            </Button>
            <Button
              size="sm"
              onClick={addEmployee}
              disabled={saving || !name.trim() || !email.trim() || password.length < 8}
              className="bg-foreground text-background hover:opacity-85"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Simpan'}
            </Button>
          </div>
        </div>
      )}

      {/* list */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-16 text-center">
          <Users className="size-9 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Belum ada karyawan</p>
          <p className="max-w-sm text-xs text-muted-foreground/70">
            Tambahkan karyawan dan atur fitur mana saja yang boleh mereka akses.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((emp) => (
            <div
              key={emp.id}
              className={`rounded-2xl border p-4 ${emp.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">
                    {emp.name}{' '}
                    {!emp.is_active && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        nonaktif
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{emp.email}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {busyId === emp.id ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resetPassword(emp)}
                        title="Ganti password"
                      >
                        <KeyRound className="size-3.5" /> Password
                      </Button>
                      {emp.is_active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setActive(emp, false)}
                        >
                          <UserX className="size-3.5" /> Nonaktifkan
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setActive(emp, true)}>
                          <UserCheck className="size-3.5" /> Aktifkan
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PERMISSIONS.map((p) => {
                  const on = emp.permissions?.[p.key] === true;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={!emp.is_active}
                      onClick={() => togglePerm(emp, p.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                        on
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Karyawan tidak pernah bisa mengakses Langganan, pengaturan outlet, atau halaman ini —
        apapun izinnya. Perubahan izin berlaku saat karyawan memuat ulang halaman.
      </p>
    </div>
  );
}

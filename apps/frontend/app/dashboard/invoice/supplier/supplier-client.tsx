"use client";

import { useEffect, useState } from "react";
import { Truck, Plus, Pencil, Trash2, Loader2, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API_URL } from "@/lib/api-url";

type Supplier = {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  note: string;
};

const emptyForm = { id: 0, name: "", phone: "", email: "", address: "", note: "" };

export function SupplierClient() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/suppliers`, { credentials: "include" });
      const json = await res.json();
      if (json.success) setSuppliers(json.data);
    } catch {
      setError("Gagal memuat data supplier.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const openAdd = () => {
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  };
  const openEdit = (s: Supplier) => {
    setForm({ ...s });
    setError("");
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError("Nama supplier wajib diisi.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const editing = form.id > 0;
      const res = await fetch(
        editing ? `${API_URL}/api/suppliers/${form.id}` : `${API_URL}/api/suppliers`,
        {
          method: editing ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            phone: form.phone,
            email: form.email,
            address: form.address,
            note: form.note,
          }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Gagal menyimpan supplier.");
        return;
      }
      setShowForm(false);
      await fetchSuppliers();
    } catch {
      setError("Terjadi kesalahan jaringan.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Supplier) => {
    try {
      await fetch(`${API_URL}/api/suppliers/${s.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      setDeleting(null);
      await fetchSuppliers();
    } catch {
      setError("Gagal menghapus supplier.");
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Truck className="size-5 text-teal-600 dark:text-teal-400" />
            Supplier
          </h1>
          <p className="text-sm text-muted-foreground">
            Kelola data supplier yang dipakai pada faktur pembelian.
          </p>
        </div>
        <Button onClick={openAdd} className="bg-teal-600 text-white hover:bg-teal-700">
          <Plus className="size-4" />
          Tambah Supplier
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border bg-card p-4 md:p-5 space-y-4">
          <h2 className="text-sm font-semibold">
            {form.id > 0 ? "Edit Supplier" : "Supplier Baru"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama *">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Mis. CV Kopi Jaya"
              />
            </Field>
            <Field label="Telepon">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="08xxxx"
              />
            </Field>
            <Field label="Email">
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="supplier@email.com"
              />
            </Field>
            <Field label="Alamat">
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Alamat supplier"
              />
            </Field>
            <Field label="Catatan" className="sm:col-span-2">
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Catatan opsional"
              />
            </Field>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
              Batal
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-teal-600 text-white hover:bg-teal-700"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Simpan
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
          <Truck className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">Belum ada supplier</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Tambahkan supplier pertama agar bisa dipilih saat membuat faktur pembelian.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => (
            <div key={s.id} className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">{s.name}</p>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(s)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(s)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              {s.phone && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="size-3" /> {s.phone}
                </p>
              )}
              {s.email && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="size-3" /> {s.email}
                </p>
              )}
              {s.address && <p className="text-xs text-muted-foreground">{s.address}</p>}
              {s.note && <p className="text-xs italic text-muted-foreground/80">{s.note}</p>}
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              Supplier &quot;{deleting?.name}&quot; akan dihapus. Faktur lama yang sudah
              memakai supplier ini tidak terpengaruh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove(deleting)}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

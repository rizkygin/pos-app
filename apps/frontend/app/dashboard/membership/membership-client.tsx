'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Coins,
  Crown,
  Loader2,
  Lock,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Ticket,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_URL } from '@/lib/api-url';
import { formatCurrency } from '@/lib/utils/format';
import { MEMBER_TIERS, TIER_BADGE, TIER_LABEL, displayPhone, type MemberTier } from '@/lib/membership';

/**
 * The owner's membership console: settings, the member list, and promo codes.
 *
 * One page with three tabs rather than three pages, because the three are read
 * together — a promo restricted to Platinum only makes sense next to how many
 * Platinum members there are, and the point value is the number the owner
 * checks before writing either.
 */

type Member = {
  id: number;
  name: string;
  phone: string;
  member_code: string;
  tier: MemberTier;
  tier_manual: boolean;
  points_balance: number;
  lifetime_spend: number;
  visit_count: number;
  note: string | null;
  created_at: string;
};

type Movement = {
  id: number;
  kind: string;
  delta: number;
  balance_after: number;
  note: string | null;
  created_at: string;
};

type Promo = {
  id: number;
  code: string;
  title: string;
  discount_type: 'percent' | 'amount';
  discount_value: number;
  min_order: number;
  max_discount: number | null;
  tiers: string[];
  member_only: boolean;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  per_member_limit: number | null;
  used_count: number;
  is_active: boolean;
};

type Settings = {
  enabled: boolean;
  earn_rp_per_point: number;
  redeem_rp_per_point: number;
  max_redeem_percent: number;
  min_redeem_points: number;
};

type TierRules = Record<MemberTier, { earn_multiplier: number; min_lifetime_spend: number }>;

type Summary = {
  members: number;
  outstandingPoints: number;
  lifetimeSpend: number;
  byTier: Record<MemberTier, number>;
};

const KIND_LABEL: Record<string, string> = {
  earn: 'Dapat poin',
  redeem: 'Tukar poin',
  reversal: 'Pembatalan',
  adjust: 'Penyesuaian',
  expire: 'Kedaluwarsa',
};

const tgl = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export function MembershipClient() {
  const [tab, setTab] = useState<'members' | 'promos' | 'settings'>('members');
  const [canUse, setCanUse] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tiers, setTiers] = useState<TierRules | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/membership/settings`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      // 403 with a plan code is the locked state, not a failure.
      setCanUse(false);
      return;
    }
    setCanUse(!!body.canUseMembership);
    setSettings(body.settings);
    setTiers(body.tiers);
  }, []);

  const loadSummary = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/membership/summary`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) setSummary(body.summary);
  }, []);

  useEffect(() => {
    loadConfig();
    loadSummary();
  }, [loadConfig, loadSummary]);

  if (canUse === null) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!canUse) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Membership belum aktif di paket Pian</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Punya database pelanggan sendiri di outlet ini: poin tiap belanja, tier Silver
              sampai Diamond, dan kode promo yang Pian buat sendiri. Tersedia di paket Ultimax.
            </p>
          </div>
          <Link
            href="/dashboard/subscription"
            className="flex shrink-0 items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-sm font-bold text-background transition-opacity hover:opacity-90"
          >
            <Sparkles className="h-4 w-4" />
            Upgrade
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && <SummaryCards summary={summary} enabled={!!settings?.enabled} />}

      {message && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${
            message.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex gap-1 rounded-xl border bg-muted/40 p-1">
        {(
          [
            ['members', 'Member', Users],
            ['promos', 'Promo', Ticket],
            ['settings', 'Pengaturan', Settings2],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'members' && <MembersTab onChanged={loadSummary} setMessage={setMessage} />}
      {tab === 'promos' && <PromosTab setMessage={setMessage} />}
      {tab === 'settings' && settings && tiers && (
        <SettingsTab
          settings={settings}
          tiers={tiers}
          onSaved={(s, t) => {
            setSettings(s);
            setTiers(t);
            setMessage({ ok: true, text: 'Pengaturan membership disimpan.' });
          }}
          setMessage={setMessage}
        />
      )}
    </div>
  );
}

function SummaryCards({ summary, enabled }: { summary: Summary; enabled: boolean }) {
  return (
    <div className="space-y-3">
      {!enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Program membership masih mati. Nyalakan di tab Pengaturan supaya kasir bisa memakainya.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Users} label="Member" value={summary.members.toLocaleString('id-ID')} />
        <Stat
          icon={Coins}
          label="Poin beredar"
          value={summary.outstandingPoints.toLocaleString('id-ID')}
        />
        <Stat icon={Crown} label="Total belanja member" value={formatCurrency(summary.lifetimeSpend)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {MEMBER_TIERS.map((t) => (
          <span
            key={t}
            className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${TIER_BADGE[t]}`}
          >
            {TIER_LABEL[t]} · {(summary.byTier[t] ?? 0).toLocaleString('id-ID')}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function MembersTab({
  onChanged,
  setMessage,
}: {
  onChanged: () => void;
  setMessage: (m: { ok: boolean; text: string } | null) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tierFilter, setTierFilter] = useState<'' | MemberTier>('');
  const [adding, setAdding] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', phone: '' });
  const [selected, setSelected] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (tierFilter) params.set('tier', tierFilter);
    const res = await fetch(`${API_URL}/api/membership/members?${params}`, {
      credentials: 'include',
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) setMembers(body.members);
    setLoading(false);
  }, [q, tierFilter]);

  // Debounced: this runs on every keystroke in the search field.
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const create = async () => {
    if (!newMember.name.trim() || !newMember.phone.trim()) return;
    const res = await fetch(`${API_URL}/api/membership/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(newMember),
    });
    const body = await res.json().catch(() => ({}));
    setMessage({ ok: res.ok && body.success, text: body.message ?? body.error ?? 'Gagal.' });
    if (res.ok && body.success) {
      setAdding(false);
      setNewMember({ name: '', phone: '' });
      load();
      onChanged();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, no. HP, atau kode member"
            className="pl-8"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as '' | MemberTier)}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="">Semua tier</option>
          {MEMBER_TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
        <Button onClick={() => setAdding((v) => !v)} className="font-bold">
          <Plus className="h-4 w-4" /> Member
        </Button>
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3">
          <Input
            value={newMember.name}
            onChange={(e) => setNewMember((m) => ({ ...m, name: e.target.value }))}
            placeholder="Nama"
            className="min-w-[160px] flex-1"
          />
          <Input
            value={newMember.phone}
            onChange={(e) => setNewMember((m) => ({ ...m, phone: e.target.value }))}
            placeholder="No. HP (08…)"
            inputMode="numeric"
            className="min-w-[160px] flex-1"
          />
          <Button onClick={create} className="font-bold">
            Simpan
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : members.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          Belum ada member. Kasir bisa mendaftarkan pelanggan langsung dari layar kasir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-bold">Member</th>
                <th className="px-4 py-2.5 text-left font-bold">Tier</th>
                <th className="px-4 py-2.5 text-right font-bold">Poin</th>
                <th className="px-4 py-2.5 text-right font-bold">Belanja</th>
                <th className="px-4 py-2.5 text-right font-bold">Kunjungan</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => setSelected(m)}
                  className="cursor-pointer border-b last:border-0 transition-colors hover:bg-muted/40"
                >
                  <td className="px-4 py-2.5">
                    <p className="font-bold">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {displayPhone(m.phone)} · {m.member_code}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded border px-1.5 py-px text-[10px] font-black uppercase ${TIER_BADGE[m.tier]}`}
                    >
                      {TIER_LABEL[m.tier]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                    {m.points_balance.toLocaleString('id-ID')}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatCurrency(m.lifetime_spend)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.visit_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <MemberDrawer
          member={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
          setMessage={setMessage}
        />
      )}
    </div>
  );
}

function MemberDrawer({
  member,
  onClose,
  onChanged,
  setMessage,
}: {
  member: Member;
  onClose: () => void;
  onChanged: () => void;
  setMessage: (m: { ok: boolean; text: string } | null) => void;
}) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [tier, setTier] = useState<MemberTier>(member.tier);
  const [adjust, setAdjust] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/membership/members/${member.id}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.success && setMovements(b.movements))
      .catch(() => {});
  }, [member.id]);

  const saveTier = async (next: MemberTier) => {
    setTier(next);
    setBusy(true);
    const res = await fetch(`${API_URL}/api/membership/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tier: next }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage({ ok: res.ok && body.success, text: body.message ?? body.error ?? 'Gagal.' });
    setBusy(false);
    if (res.ok) onChanged();
  };

  const applyAdjust = async () => {
    const delta = Math.trunc(Number(adjust));
    if (!delta) return;
    setBusy(true);
    const res = await fetch(`${API_URL}/api/membership/members/${member.id}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ delta, note: 'Penyesuaian oleh pemilik' }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage({ ok: res.ok && body.success, text: body.message ?? body.error ?? 'Gagal.' });
    setBusy(false);
    if (res.ok && body.success) {
      setAdjust('');
      onChanged();
      onClose();
    }
  };

  const remove = async () => {
    if (!confirm(`Hapus member ${member.name}? Riwayat poinnya tetap tersimpan.`)) return;
    setBusy(true);
    const res = await fetch(`${API_URL}/api/membership/members/${member.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const body = await res.json().catch(() => ({}));
    setMessage({ ok: res.ok && body.success, text: body.message ?? body.error ?? 'Gagal.' });
    setBusy(false);
    if (res.ok) {
      onChanged();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-card p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <p className="truncate text-lg font-black">{member.name}</p>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {displayPhone(member.phone)} · {member.member_code} · sejak {tgl(member.created_at)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted" aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border bg-muted/30 p-2.5">
            <p className="text-xs text-muted-foreground">Poin</p>
            <p className="text-lg font-black tabular-nums">
              {member.points_balance.toLocaleString('id-ID')}
            </p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-2.5">
            <p className="text-xs text-muted-foreground">Belanja</p>
            <p className="text-lg font-black tabular-nums">{formatCurrency(member.lifetime_spend)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-2.5">
            <p className="text-xs text-muted-foreground">Kunjungan</p>
            <p className="text-lg font-black tabular-nums">{member.visit_count}</p>
          </div>
        </div>

        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">Tier</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {MEMBER_TIERS.map((t) => (
            <button
              key={t}
              disabled={busy}
              onClick={() => saveTier(t)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-opacity disabled:opacity-50 ${
                tier === t ? TIER_BADGE[t] : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Tier yang Pian pilih sendiri tidak akan diubah otomatis oleh sistem.
        </p>

        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Sesuaikan poin
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            value={adjust}
            onChange={(e) => setAdjust(e.target.value)}
            placeholder="cth. 50 atau -20"
            inputMode="numeric"
            className="flex-1"
          />
          <Button onClick={applyAdjust} disabled={busy || !adjust.trim()} className="font-bold">
            Terapkan
          </Button>
        </div>

        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Riwayat poin
        </p>
        <div className="mt-1.5 space-y-1">
          {movements.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">Belum ada riwayat.</p>
          ) : (
            movements.map((mv) => (
              <div key={mv.id} className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{KIND_LABEL[mv.kind] ?? mv.kind}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {tgl(mv.created_at)}
                    {mv.note ? ` · ${mv.note}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-black tabular-nums ${
                    mv.delta >= 0 ? 'text-emerald-600' : 'text-rose-500'
                  }`}
                >
                  {mv.delta > 0 ? '+' : ''}
                  {mv.delta.toLocaleString('id-ID')}
                </span>
              </div>
            ))
          )}
        </div>

        <button
          onClick={remove}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 py-2 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:hover:bg-rose-950/40"
        >
          <Trash2 className="h-4 w-4" />
          Hapus member
        </button>
      </div>
    </div>
  );
}

// ── Promos ──────────────────────────────────────────────────────────────────

const EMPTY_PROMO = {
  code: '',
  title: '',
  discount_type: 'percent' as 'percent' | 'amount',
  discount_value: '',
  min_order: '',
  max_discount: '',
  tiers: [] as MemberTier[],
  member_only: true,
  valid_until: '',
  usage_limit: '',
  per_member_limit: '',
};

function PromosTab({
  setMessage,
}: {
  setMessage: (m: { ok: boolean; text: string } | null) => void;
}) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof EMPTY_PROMO | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API_URL}/api/membership/promos`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) setPromos(body.promos);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    const res = await fetch(`${API_URL}/api/membership/promos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        ...form,
        discount_value: Number(form.discount_value),
        min_order: Number(form.min_order) || 0,
        max_discount: form.max_discount || null,
        usage_limit: form.usage_limit || null,
        per_member_limit: form.per_member_limit || null,
        valid_until: form.valid_until || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setMessage({ ok: res.ok && body.success, text: body.message ?? body.error ?? 'Gagal.' });
    setBusy(false);
    if (res.ok && body.success) {
      setForm(null);
      load();
    }
  };

  const toggle = async (p: Promo) => {
    const res = await fetch(`${API_URL}/api/membership/promos/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    if (res.ok) load();
  };

  const remove = async (p: Promo) => {
    if (!confirm(`Hapus promo ${p.code}?`)) return;
    const res = await fetch(`${API_URL}/api/membership/promos/${p.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) load();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setForm(form ? null : { ...EMPTY_PROMO })} className="font-bold">
          <Plus className="h-4 w-4" /> Promo
        </Button>
      </div>

      {form && (
        <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Kode">
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="HEMAT10"
              />
            </Field>
            <Field label="Judul">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Diskon 10% member"
              />
            </Field>
            <Field label="Jenis diskon">
              <select
                value={form.discount_type}
                onChange={(e) =>
                  setForm({ ...form, discount_type: e.target.value as 'percent' | 'amount' })
                }
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="percent">Persen (%)</option>
                <option value="amount">Rupiah</option>
              </select>
            </Field>
            <Field label={form.discount_type === 'percent' ? 'Besar diskon (%)' : 'Besar diskon (Rp)'}>
              <Input
                value={form.discount_value}
                onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                inputMode="numeric"
              />
            </Field>
            <Field label="Minimal belanja (Rp)">
              <Input
                value={form.min_order}
                onChange={(e) => setForm({ ...form, min_order: e.target.value })}
                inputMode="numeric"
                placeholder="0"
              />
            </Field>
            {form.discount_type === 'percent' && (
              <Field label="Maksimal potongan (Rp)">
                <Input
                  value={form.max_discount}
                  onChange={(e) => setForm({ ...form, max_discount: e.target.value })}
                  inputMode="numeric"
                  placeholder="tanpa batas"
                />
              </Field>
            )}
            <Field label="Berlaku sampai">
              <Input
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
              />
            </Field>
            <Field label="Kuota total">
              <Input
                value={form.usage_limit}
                onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
                inputMode="numeric"
                placeholder="tanpa batas"
              />
            </Field>
            <Field label="Kuota per member">
              <Input
                value={form.per_member_limit}
                onChange={(e) => setForm({ ...form, per_member_limit: e.target.value })}
                inputMode="numeric"
                placeholder="tanpa batas"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={form.member_only}
              onChange={(e) => setForm({ ...form, member_only: e.target.checked })}
            />
            Khusus member
          </label>

          {form.member_only && (
            <div>
              <p className="text-xs font-bold text-muted-foreground">
                Tier yang boleh pakai (kosong = semua tier)
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {MEMBER_TIERS.map((t) => {
                  const on = form.tiers.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          tiers: on ? form.tiers.filter((x) => x !== t) : [...form.tiers, t],
                        })
                      }
                      className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                        on ? TIER_BADGE[t] : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {TIER_LABEL[t]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)}>
              Batal
            </Button>
            <Button onClick={save} disabled={busy} className="font-bold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan promo'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : promos.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          Belum ada kode promo. Kasir mengetik kodenya di layar kasir saat pelanggan menyebutkannya.
        </p>
      ) : (
        <div className="space-y-2">
          {promos.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-xs font-black text-background">
                    {p.code}
                  </span>
                  <span className="font-bold">{p.title}</span>
                  {!p.is_active && (
                    <span className="rounded border px-1.5 py-px text-[10px] font-bold uppercase text-muted-foreground">
                      nonaktif
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.discount_type === 'percent'
                    ? `${p.discount_value}%${p.max_discount ? ` (maks ${formatCurrency(p.max_discount)})` : ''}`
                    : formatCurrency(p.discount_value)}
                  {p.min_order > 0 ? ` · min ${formatCurrency(p.min_order)}` : ''}
                  {p.member_only ? ' · khusus member' : ' · semua pelanggan'}
                  {p.tiers.length > 0
                    ? ` · ${p.tiers.map((t) => TIER_LABEL[t as MemberTier] ?? t).join(', ')}`
                    : ''}
                  {` · dipakai ${p.used_count}${p.usage_limit ? `/${p.usage_limit}` : ''}`}
                  {p.valid_until ? ` · sampai ${tgl(p.valid_until)}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button variant="outline" onClick={() => toggle(p)} className="text-xs font-bold">
                  {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </Button>
                <button
                  onClick={() => remove(p)}
                  className="rounded-lg border border-rose-200 px-2 text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/40"
                  aria-label={`Hapus ${p.code}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsTab({
  settings,
  tiers,
  onSaved,
  setMessage,
}: {
  settings: Settings;
  tiers: TierRules;
  onSaved: (s: Settings, t: TierRules) => void;
  setMessage: (m: { ok: boolean; text: string } | null) => void;
}) {
  const [s, setS] = useState<Settings>(settings);
  const [t, setT] = useState<TierRules>(tiers);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await fetch(`${API_URL}/api/membership/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ settings: s, tiers: t }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && body.success) onSaved(body.settings, body.tiers);
    else setMessage({ ok: false, text: body.error ?? 'Gagal menyimpan.' });
  };

  // A worked example on a round bill, because "rupiah per point" is the number
  // owners misjudge, and it only becomes obvious in a real transaction.
  const exampleBill = 200000;
  const examplePoints = Math.floor(exampleBill / (s.earn_rp_per_point || 1));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <label className="flex items-center justify-between gap-3">
          <div>
            <p className="font-bold">Program membership</p>
            <p className="text-xs text-muted-foreground">
              Saat mati, kolom member dan promo hilang dari layar kasir.
            </p>
          </div>
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => setS({ ...s, enabled: e.target.checked })}
            className="h-5 w-5 shrink-0"
          />
        </label>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <p className="font-bold">Nilai poin</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Belanja per 1 poin (Rp)">
            <Input
              value={s.earn_rp_per_point}
              onChange={(e) => setS({ ...s, earn_rp_per_point: Number(e.target.value) || 0 })}
              inputMode="numeric"
            />
          </Field>
          <Field label="Nilai 1 poin saat ditukar (Rp)">
            <Input
              value={s.redeem_rp_per_point}
              onChange={(e) => setS({ ...s, redeem_rp_per_point: Number(e.target.value) || 0 })}
              inputMode="numeric"
            />
          </Field>
          <Field label="Maksimal potongan poin (% dari tagihan)">
            <Input
              value={s.max_redeem_percent}
              onChange={(e) => setS({ ...s, max_redeem_percent: Number(e.target.value) || 0 })}
              inputMode="numeric"
            />
          </Field>
          <Field label="Minimal poin sekali tukar">
            <Input
              value={s.min_redeem_points}
              onChange={(e) => setS({ ...s, min_redeem_points: Number(e.target.value) || 0 })}
              inputMode="numeric"
            />
          </Field>
        </div>
        <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Contoh: belanja {formatCurrency(exampleBill)} memberi{' '}
          <b>{examplePoints.toLocaleString('id-ID')} poin</b> untuk member Silver. Poin itu bernilai{' '}
          <b>{formatCurrency(examplePoints * s.redeem_rp_per_point)}</b> saat ditukar, maksimal{' '}
          {s.max_redeem_percent}% dari tagihan.
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <p className="font-bold">Tier</p>
        <p className="text-xs text-muted-foreground">
          Member naik tier otomatis begitu total belanjanya melewati batas. Pengali menentukan
          berapa kali lipat poin yang mereka dapat.
        </p>
        <div className="mt-3 space-y-2">
          {MEMBER_TIERS.map((tier) => (
            <div key={tier} className="flex flex-wrap items-center gap-2">
              <span
                className={`w-24 shrink-0 rounded-lg border px-2 py-1 text-center text-xs font-black uppercase ${TIER_BADGE[tier]}`}
              >
                {TIER_LABEL[tier]}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Pengali
                <Input
                  value={t[tier].earn_multiplier}
                  onChange={(e) =>
                    setT({
                      ...t,
                      [tier]: { ...t[tier], earn_multiplier: Number(e.target.value) || 0 },
                    })
                  }
                  className="h-8 w-20"
                  inputMode="decimal"
                />
              </label>
              <label className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                Naik tier setelah belanja (Rp)
                <Input
                  value={t[tier].min_lifetime_spend}
                  onChange={(e) =>
                    setT({
                      ...t,
                      [tier]: { ...t[tier], min_lifetime_spend: Number(e.target.value) || 0 },
                    })
                  }
                  className="h-8 min-w-[120px] flex-1"
                  inputMode="numeric"
                  disabled={tier === 'silver'}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy} className="font-bold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Simpan pengaturan'}
        </Button>
      </div>
    </div>
  );
}
